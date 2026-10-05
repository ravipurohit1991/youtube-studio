import type { AiProgress, AskRequest, InsightRequest, InsightResult, LibraryItem, OrganizeGroup, OrganizeResult } from '@shared/types'
import { scanLibrary } from '../library'
import { libraryState } from '../library-state'
import { chat, chatJson, requireReady, type ChatMessage } from './ollama'
import { clock, contextText, videoContext } from './transcript'

/** Video insights (summary, questions) and library organization. */

type Emit = (progress: Omit<AiProgress, 'requestId'>) => void

const SUMMARY_SYSTEM = `You help someone decide whether a YouTube video is worth their time and get its value fast. You are given the video's title, description, chapters and transcript with [mm:ss] timestamps.

Write the summary in English, in exactly this shape and nothing else:

## TL;DW
Two or three sentences: what the video actually delivers (the substance, not the hype).

## Key moments
- [mm:ss] One line per important point, in order, 5 to 8 bullets. Use only timestamps that appear in the transcript or chapters.

## Worth watching?
One or two sentences: who it is for, how solid the information is, whether the title over-promises, and any sponsor segment or skippable part with its timestamp.

Formatting: plain text, "## " headings and "- " bullets only, **bold** sparingly. No preamble, no closing remarks. If there is no transcript, say so in the TL;DW and work from the description and chapters.`

const ASK_SYSTEM = `You answer questions about one YouTube video, using its transcript (with [mm:ss] timestamps), description and chapters given below.

- Be direct and concise. Cite where in the video things are said as [mm:ss] so the viewer can jump there.
- If the video does not cover something, say so plainly. You may add general knowledge when it helps, but mark it as not from the video.
- Answer in the language of the question. Plain text; "- " bullets and **bold** are fine.`

function source(ctx: Awaited<ReturnType<typeof videoContext>>): InsightResult['source'] {
  return ctx.source
}

export async function summarize(req: InsightRequest, emit: Emit, signal: AbortSignal): Promise<InsightResult> {
  const model = requireReady()
  emit({ stage: 'Reading the transcript…' })
  const ctx = await videoContext(req.url)
  emit({ stage: 'Summarizing…', source: source(ctx) })
  const text = await chat(
    [
      { role: 'system', content: SUMMARY_SYSTEM },
      { role: 'user', content: contextText(ctx) },
    ],
    {
      signal,
      longContext: true,
      temperature: 0.3,
      onThinking: () => emit({ thinking: true, stage: 'Thinking…' }),
      onDelta: (delta) => emit({ delta }),
    },
  )
  return { requestId: req.requestId, source: source(ctx), text, model }
}

export async function ask(req: AskRequest, emit: Emit, signal: AbortSignal): Promise<InsightResult> {
  const model = requireReady()
  const question = req.question.trim()
  if (!question) throw new Error('Type a question first.')
  emit({ stage: 'Reading the transcript…' })
  const ctx = await videoContext(req.url)
  emit({ stage: 'Thinking…', source: source(ctx) })
  const history: ChatMessage[] = (req.history ?? [])
    .slice(-8)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
  const text = await chat(
    [
      { role: 'system', content: ASK_SYSTEM + '\n\n' + contextText(ctx) },
      ...history,
      { role: 'user', content: question },
    ],
    {
      signal,
      longContext: true,
      temperature: 0.3,
      onThinking: () => emit({ thinking: true, stage: 'Thinking…' }),
      onDelta: (delta) => emit({ delta }),
    },
  )
  return { requestId: req.requestId, source: source(ctx), text, model }
}

// ---------- smart playlists ----------

const ORGANIZE_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' }, items: { type: 'array', items: { type: 'integer' } } },
        required: ['name', 'description', 'items'],
      },
    },
  },
  required: ['groups'],
}

const ORGANIZE_SYSTEM = `You organize someone's downloaded videos and music into playlists they would actually use. You get a numbered list (number. title | channel | video/audio | length).

Make 3 to 10 playlists grouped by topic, genre, mood, series or purpose (e.g. "Deep work focus music", "Rust from zero", "Late-night jazz"). Each needs at least 3 items. An item goes in at most one playlist; skip items that fit nowhere. Names: short and clear, max 40 characters, no emoji, not the same as an existing playlist. description: one short line on what ties it together.

Return JSON {"groups": [{"name": "...", "description": "...", "items": [numbers]}]}. Only use numbers from the list.`

const MAX_ORGANIZE = 300

export async function organize(requestId: string, emit: Emit, signal: AbortSignal): Promise<OrganizeResult> {
  const model = requireReady()
  emit({ stage: 'Reading your library…' })
  const items = (await scanLibrary()).slice().sort((a, b) => b.mtime - a.mtime).slice(0, MAX_ORGANIZE)
  if (items.length < 6) throw new Error('Download a few more videos first: there is not enough in your library to sort into playlists.')
  const existing = libraryState.get().playlists.map((p) => p.name)
  const label = (item: LibraryItem, index: number): string =>
    index + 1 + '. ' + (item.title ?? item.name).slice(0, 120) + ' | ' + (item.uploader ?? '?') + ' | ' + item.kind + ' | ' + (item.duration ? clock(item.duration) : '?')
  emit({ stage: 'Grouping ' + items.length + ' items into playlists…' })
  const parts = ['Library:\n' + items.map(label).join('\n')]
  if (existing.length) parts.unshift('Existing playlists (do not reuse these names): ' + existing.join(', '))
  const raw = await chatJson<{ groups?: { name?: string; description?: string; items?: number[] }[] }>(
    [
      { role: 'system', content: ORGANIZE_SYSTEM },
      { role: 'user', content: parts.join('\n\n') },
    ],
    ORGANIZE_SCHEMA,
    { signal, longContext: true, temperature: 0.3, onThinking: () => emit({ thinking: true, stage: 'Thinking about how to group them…' }) },
  )
  const used = new Set<number>()
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  const groups: OrganizeGroup[] = []
  ;(raw.groups ?? []).forEach((g) => {
    const name = String(g?.name ?? '').trim().slice(0, 60)
    if (!name || taken.has(name.toLowerCase())) return
    const keys: string[] = []
    ;(Array.isArray(g.items) ? g.items : []).forEach((n) => {
      const index = Math.round(Number(n)) - 1
      if (index < 0 || index >= items.length || used.has(index)) return
      used.add(index)
      keys.push(items[index].key)
    })
    if (keys.length < 2) return
    taken.add(name.toLowerCase())
    groups.push({ name, description: String(g.description ?? '').trim().slice(0, 160), keys })
  })
  if (!groups.length) throw new Error('The model did not come up with usable playlists. Try again or pick another model.')
  return { requestId, groups, considered: items.length, model }
}
