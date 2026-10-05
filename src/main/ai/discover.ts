import type { DiscoverLength, DiscoverQuery, DiscoverRecency, DiscoverRequest, DiscoverResult, DiscoverSort, DiscoverVideo, LibraryItem } from '@shared/types'
import { scanLibrary } from '../library'
import { libraryState } from '../library-state'
import { log, logError } from '../logger'
import { imageProxyUrl } from '../media-server'
import { searchVideos, type SearchHit } from '../ytdlp'
import { CanceledError, chatJson, requireReady, webSearch, type ChatMessage, type WebResult } from './ollama'
import { isBlocked, rememberRequest, taste } from './taste'

/**
 * Discover: your own recommendation algorithm. The model turns a plain-language request (plus your
 * taste profile) into several YouTube searches with real filters, yt-dlp runs them, and the model
 * then ranks every candidate for this one person, with a reason for each pick.
 */

type Report = (stage: string) => void

const RECENCY_CODE: Record<Exclude<DiscoverRecency, 'any'>, number> = { today: 2, week: 3, month: 4, year: 5 }
const LENGTH_CODE: Record<Exclude<DiscoverLength, 'any'>, number> = { short: 1, long: 2, medium: 3 }
const SORT_CODE: Record<DiscoverSort, number> = { relevance: 0, rating: 1, date: 2, views: 3 }
const SORTS: DiscoverSort[] = ['relevance', 'date', 'views', 'rating']
const RECENCIES: DiscoverRecency[] = ['any', 'today', 'week', 'month', 'year']
const MAX_QUERIES = 6
const MAX_CANDIDATES = 70
const MAX_RESULTS = 24

/**
 * YouTube's search filters ("sp" parameter) are a small protobuf: field 1 = sort, field 2 = filters
 * { 1: upload date, 2: type (1 = video), 3: duration }. Always restricting to videos keeps channels
 * and playlists out of the results.
 */
export function searchParam(sort: DiscoverSort, recency: DiscoverRecency, length: DiscoverLength): string {
  const filters: number[] = []
  if (recency !== 'any') filters.push(0x08, RECENCY_CODE[recency])
  filters.push(0x10, 0x01)
  if (length !== 'any') filters.push(0x18, LENGTH_CODE[length])
  const bytes: number[] = []
  if (SORT_CODE[sort]) bytes.push(0x08, SORT_CODE[sort])
  bytes.push(0x12, filters.length, ...filters)
  return Buffer.from(bytes).toString('base64')
}

export function searchUrl(query: string, sort: DiscoverSort, recency: DiscoverRecency, length: DiscoverLength): string {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=' + encodeURIComponent(searchParam(sort, recency, length))
}

function minutes(seconds: number | null): string {
  if (!seconds) return '?'
  if (seconds < 60) return Math.round(seconds) + 's'
  return Math.round(seconds / 60) + ' min'
}

function compactCount(n: number | null): string {
  if (n === null) return '?'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'K'
  return String(n)
}

// ---------- taste profile ----------

interface Profile {
  text: string
  /** There is enough to build a "for you" request from. */
  usable: boolean
  ownedIds: Set<string>
}

async function buildProfile(personalize: boolean): Promise<Profile> {
  let items: LibraryItem[] = []
  try {
    items = await scanLibrary()
  } catch (err) {
    logError('ai.profile.scan', err)
  }
  const ownedIds = new Set(items.map((item) => item.videoId).filter((id): id is string => !!id))
  const t = taste()
  if (!personalize) {
    return { text: t.blockedChannels.length ? 'Never suggest these channels: ' + t.blockedChannels.join(', ') : '', usable: false, ownedIds }
  }
  const state = libraryState.get()
  const seen = new Set<string>()
  const unique = items
    .slice()
    .sort((a, b) => b.mtime - a.mtime)
    .filter((item) => {
      const id = item.videoId ?? item.key
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
  const channelCounts = new Map<string, number>()
  unique.forEach((item) => {
    if (item.uploader) channelCounts.set(item.uploader, (channelCounts.get(item.uploader) ?? 0) + 1)
  })
  const channels = Array.from(channelCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, count]) => name + ' (' + count + ')')
  const titleOf = (item: LibraryItem): string => (item.title ?? item.name).slice(0, 110)
  const favorites = unique.filter((item) => state.favorites.includes(item.key)).slice(0, 12).map(titleOf)
  const finished = unique.filter((item) => state.progress[item.key]?.watched).slice(0, 10).map(titleOf)
  const recent = unique.slice(0, 25).map(titleOf)
  const lines: string[] = []
  if (channels.length) lines.push('Channels they download most: ' + channels.join(', '))
  if (favorites.length) lines.push('Favorites:\n- ' + favorites.join('\n- '))
  if (finished.length) lines.push('Watched to the end:\n- ' + finished.join('\n- '))
  if (recent.length) lines.push('Recently downloaded:\n- ' + recent.join('\n- '))
  const label = (x: { title: string; channel: string | null }): string => x.title.slice(0, 110) + (x.channel ? ' (' + x.channel + ')' : '')
  if (t.liked.length) lines.push('Suggestions they liked:\n- ' + t.liked.slice(0, 15).map(label).join('\n- '))
  if (t.disliked.length) lines.push('Suggestions they disliked (steer away from similar):\n- ' + t.disliked.slice(0, 15).map(label).join('\n- '))
  if (t.recent.length) lines.push('Things they asked for recently: ' + t.recent.slice(0, 6).map((r) => '"' + r + '"').join(', '))
  const usable = lines.length > 0
  if (t.blockedChannels.length) lines.push('Never suggest these channels: ' + t.blockedChannels.join(', '))
  return { text: lines.join('\n\n'), usable, ownedIds }
}

// ---------- plan ----------

interface Plan {
  intent: string
  queries: { q: string; sort: DiscoverSort }[]
  recency: DiscoverRecency
  minMinutes: number
  maxMinutes: number
  allowShorts: boolean
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    queries: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, sort: { type: 'string', enum: SORTS } },
        required: ['q', 'sort'],
      },
    },
    recency: { type: 'string', enum: RECENCIES },
    minMinutes: { type: 'number' },
    maxMinutes: { type: 'number' },
    allowShorts: { type: 'boolean' },
  },
  required: ['intent', 'queries', 'recency', 'minMinutes', 'maxMinutes', 'allowShorts'],
}

const PLAN_SYSTEM = `You are the search planner inside YTD Studio, a personal YouTube app. Your job: turn what the user wants into YouTube searches that surface the best videos for them, so they do not depend on YouTube's engagement-driven recommendations.

Return JSON with:
- intent: one short sentence (max 20 words) restating what they want, in second person ("You want ...").
- queries: 3 to 6 YouTube searches. Make them diverse: different phrasings, sub-topics, formats (tutorial, documentary, talk, live session...), and well-known high quality creators or channels in this niche when you know them. Write each like a person types into YouTube: 2 to 7 words, no quotes, no operators, no hashtags. Use the language the content should be in.
- For each query, sort: "date" when they want new/latest/recent things, "views" for popular or classic picks, "rating" rarely, otherwise "relevance".
- recency: "today", "week", "month" or "year" only when the request is clearly about a time window, else "any".
- minMinutes / maxMinutes: length bounds implied by the request (e.g. "quick" -> maxMinutes 10, "full course" or "long" -> minMinutes 40, "podcast" -> minMinutes 20). Use 0 for no bound.
- allowShorts: true only if they want YouTube Shorts / very short clips.

Follow-up adjustments, when present, refine the original request: apply all of them, the most recent wins on conflicts. Use the taste profile, when present, to pick angles and creators they will like, but the explicit request always wins.`

async function planSearches(req: DiscoverRequest, profile: Profile, web: WebResult[], report: Report, signal: AbortSignal): Promise<Plan> {
  const parts: string[] = []
  const prompt = req.prompt.trim()
  if (prompt) parts.push('Request: ' + prompt)
  else
    parts.push(
      'Request: none given. Suggest fresh videos they will probably love, based only on the taste profile below: mostly closely related topics and creators, plus one or two adjacent discoveries. Do not repeat titles they already have.',
    )
  const refinements = (req.refinements ?? []).map((r) => r.trim()).filter(Boolean)
  if (refinements.length) parts.push('Follow-up adjustments (oldest first):\n- ' + refinements.join('\n- '))
  if (req.avoid && req.avoid.trim()) parts.push('Always avoid: ' + req.avoid.trim())
  if (req.length !== 'any') parts.push('Length filter chosen in the app: ' + req.length + ' (already applied to every search).')
  if (req.recency !== 'any') parts.push('Upload date filter chosen in the app: ' + req.recency + ' (already applied to every search).')
  if (web.length) parts.push('Fresh context from a web search (use it for names, releases and current events, ignore if irrelevant):\n' + web.map((w) => '- ' + w.title + ': ' + w.content.slice(0, 280)).join('\n'))
  if (profile.text) parts.push('Taste profile:\n' + profile.text)
  report('Planning searches…')
  const messages: ChatMessage[] = [
    { role: 'system', content: PLAN_SYSTEM },
    { role: 'user', content: parts.join('\n\n') },
  ]
  const raw = await chatJson<Partial<Plan>>(messages, PLAN_SCHEMA, { signal, temperature: 0.5, onThinking: () => report('Thinking about what you want…') })
  const queries = (Array.isArray(raw.queries) ? raw.queries : [])
    .map((q) => ({ q: String(q?.q ?? '').replace(/["#]/g, '').trim().slice(0, 100), sort: SORTS.includes(q?.sort as DiscoverSort) ? (q.sort as DiscoverSort) : 'relevance' }))
    .filter((q) => q.q.length > 1)
  const seen = new Set<string>()
  const unique = queries.filter((q) => {
    const key = q.q.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    intent: String(raw.intent ?? '').trim().slice(0, 240),
    queries: unique.slice(0, MAX_QUERIES),
    recency: RECENCIES.includes(raw.recency as DiscoverRecency) ? (raw.recency as DiscoverRecency) : 'any',
    minMinutes: typeof raw.minMinutes === 'number' && raw.minMinutes > 0 ? raw.minMinutes : 0,
    maxMinutes: typeof raw.maxMinutes === 'number' && raw.maxMinutes > 0 ? raw.maxMinutes : 0,
    allowShorts: raw.allowShorts === true,
  }
}

// ---------- rank ----------

interface Candidate extends SearchHit {
  query: string
}

const RANK_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, score: { type: 'integer' }, why: { type: 'string' } },
        required: ['i', 'score', 'why'],
      },
    },
  },
  required: ['picks'],
}

const RANK_SYSTEM = `You are the ranking step of a personal YouTube recommender. You get a request and numbered search results. Pick the videos this person should actually watch.

Score each pick 0-100 for fit. Reward: directly on topic, substance over hype, credible or well-known creators, a format and length that match the request, and the taste profile. Penalize: clickbait or misleading titles, reaction videos, reuploads, compilations and low-effort AI slop (unless asked for), off-topic results, near-duplicates of a better pick, and anything resembling what they disliked.

Return JSON {"picks": [{"i": <number of the result>, "score": <0-100>, "why": "<one specific sentence, max 18 words, on what makes this one fit>"}]}, best first, at most ${MAX_RESULTS} picks, only scores of 40 or more. Never invent numbers that are not in the list.`

function roundRobin(groups: Candidate[][], limit: number): Candidate[] {
  const out: Candidate[] = []
  for (let row = 0; out.length < limit; row += 1) {
    let added = false
    groups.forEach((group) => {
      if (row < group.length && out.length < limit) {
        out.push(group[row])
        added = true
      }
    })
    if (!added) break
  }
  return out
}

async function rank(req: DiscoverRequest, plan: Plan, candidates: Candidate[], profile: Profile, report: Report, signal: AbortSignal): Promise<{ i: number; score: number; why: string }[]> {
  report('Ranking ' + candidates.length + ' videos for you…')
  const list = candidates
    .map((c, index) => {
      const snippet = c.description ? ' | ' + c.description.replace(/\s+/g, ' ').slice(0, 140) : ''
      return index + 1 + '. ' + c.title.slice(0, 140) + ' | ' + (c.channel ?? '?') + ' | ' + minutes(c.duration) + ' | ' + compactCount(c.views) + ' views' + snippet
    })
    .join('\n')
  const parts = ['Request: ' + (plan.intent || req.prompt.trim() || 'videos they will love, based on their taste')]
  const refinements = (req.refinements ?? []).filter((r) => r.trim())
  if (refinements.length) parts.push('Adjustments: ' + refinements.join('; '))
  if (req.avoid && req.avoid.trim()) parts.push('Always avoid: ' + req.avoid.trim())
  if (profile.text) parts.push('Taste profile:\n' + profile.text)
  parts.push('Results (number. title | channel | length | views | snippet):\n' + list)
  const raw = await chatJson<{ picks?: { i?: number; score?: number; why?: string }[] }>(
    [
      { role: 'system', content: RANK_SYSTEM },
      { role: 'user', content: parts.join('\n\n') },
    ],
    RANK_SCHEMA,
    { signal, temperature: 0.2, onThinking: () => report('Weighing ' + candidates.length + ' videos…') },
  )
  const used = new Set<number>()
  return (raw.picks ?? [])
    .map((p) => ({ i: Math.round(Number(p?.i)) - 1, score: Math.max(0, Math.min(100, Math.round(Number(p?.score)))), why: String(p?.why ?? '').trim().slice(0, 200) }))
    .filter((p) => {
      if (!(p.i >= 0 && p.i < candidates.length) || used.has(p.i) || isNaN(p.score)) return false
      used.add(p.i)
      return true
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
}

// ---------- pipeline ----------

async function runSearches(plan: Plan, req: DiscoverRequest, report: Report, signal: AbortSignal): Promise<{ queries: DiscoverQuery[]; groups: Candidate[][] }> {
  const recency = req.recency !== 'any' ? req.recency : plan.recency
  const length = req.length
  const perQuery = plan.queries.length <= 3 ? 20 : 15
  const results: Candidate[][] = plan.queries.map(() => [])
  const errors: string[] = []
  let done = 0
  report('Searching YouTube (0/' + plan.queries.length + ')…')
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < plan.queries.length) {
      const index = next
      next += 1
      if (signal.aborted) throw new CanceledError()
      const query = plan.queries[index]
      try {
        const hits = await searchVideos(searchUrl(query.q, query.sort, recency, length), perQuery)
        results[index] = hits.map((hit) => ({ ...hit, query: query.q }))
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
        logError('ai.search ' + query.q, err)
      }
      done += 1
      report('Searching YouTube (' + done + '/' + plan.queries.length + ')…')
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (signal.aborted) throw new CanceledError()
  if (results.every((r) => !r.length) && errors.length) throw new Error('YouTube search failed: ' + errors[0])
  return {
    queries: plan.queries.map((q, index) => ({ q: q.q, sort: q.sort, found: results[index].length })),
    groups: results,
  }
}

export async function discover(req: DiscoverRequest, report: Report, signal: AbortSignal): Promise<DiscoverResult> {
  const model = requireReady()
  const started = Date.now()
  report('Reading your taste profile…')
  const profile = await buildProfile(req.personalize)
  if (!req.prompt.trim() && !profile.usable) {
    throw new Error(
      req.personalize
        ? 'Nothing to personalize from yet: your library is empty. Describe what you want to watch instead.'
        : 'Describe what you want to watch, or turn on "Personalize" to get picks based on your library.',
    )
  }

  let web: WebResult[] = []
  if (req.useWeb && req.prompt.trim()) {
    report('Looking it up on the web…')
    try {
      web = await webSearch(req.prompt.trim(), 5, signal)
    } catch (err) {
      if (err instanceof CanceledError) throw err
      logError('ai.webSearch', err)
    }
  }

  let plan: Plan
  try {
    plan = await planSearches(req, profile, web, report, signal)
  } catch (err) {
    if (err instanceof CanceledError || signal.aborted || !req.prompt.trim()) throw err
    // Planning is a nicety: with a request in hand, a plain search still works.
    logError('ai.plan', err)
    plan = { intent: '', queries: [], recency: 'any', minMinutes: 0, maxMinutes: 0, allowShorts: false }
  }
  if (!plan.queries.length) {
    if (!req.prompt.trim()) throw new Error('The model did not suggest any searches. Try again or describe what you want.')
    plan.queries = [{ q: req.prompt.trim().slice(0, 100), sort: 'relevance' }]
  }
  log('ai.discover plan: ' + plan.queries.map((q) => q.q + ' [' + q.sort + ']').join(' | '))

  const { queries, groups } = await runSearches(plan, req, report, signal)
  const exclude = new Set(req.exclude ?? [])
  const disliked = new Set(taste().disliked.map((d) => d.id))
  const seen = new Set<string>()
  const filtered = groups.map((group) =>
    group.filter((hit) => {
      if (seen.has(hit.id)) return false
      seen.add(hit.id)
      if (exclude.has(hit.id) || disliked.has(hit.id) || profile.ownedIds.has(hit.id)) return false
      if (hit.live || isBlocked(hit.channel)) return false
      if (hit.short && !plan.allowShorts) return false
      if (hit.duration !== null) {
        if (plan.minMinutes && hit.duration < plan.minMinutes * 60) return false
        if (plan.maxMinutes && hit.duration > plan.maxMinutes * 60) return false
      }
      return true
    }),
  )
  const candidates = roundRobin(filtered, MAX_CANDIDATES)
  if (!candidates.length) throw new Error('YouTube returned nothing new for these searches. Try loosening the filters or rephrasing.')

  let unranked = false
  let picks: { i: number; score: number | null; why: string | null }[] = []
  try {
    picks = await rank(req, plan, candidates, profile, report, signal)
  } catch (err) {
    if (err instanceof CanceledError || signal.aborted) throw new CanceledError()
    logError('ai.rank', err)
  }
  if (!picks.length) {
    unranked = true
    picks = candidates.slice(0, MAX_RESULTS).map((_, i) => ({ i, score: null, why: null }))
  }
  const videos: DiscoverVideo[] = picks.map((p) => {
    const c = candidates[p.i]
    return {
      id: c.id,
      url: c.url,
      title: c.title,
      channel: c.channel,
      duration: c.duration,
      views: c.views,
      thumbnail: imageProxyUrl('https://i.ytimg.com/vi/' + c.id + '/mqdefault.jpg'),
      score: p.score,
      reason: p.why || null,
      query: c.query,
    }
  })
  if (req.prompt.trim()) rememberRequest(req.prompt)
  return {
    requestId: req.requestId,
    intent: plan.intent || (req.prompt.trim() ? 'Results for "' + req.prompt.trim() + '"' : 'Picks based on your library'),
    queries,
    videos,
    candidates: candidates.length,
    webSources: web.filter((w) => w.url).map((w) => ({ title: w.title || w.url, url: w.url })),
    model,
    elapsedMs: Date.now() - started,
    unranked,
  }
}
