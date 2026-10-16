import type { AiProgress, LibraryAnswer, LibraryAskRequest, LibrarySource, TranscriptLine } from '@shared/types'
import { fold, libraryTranscripts } from '../transcript-index'
import { chat, chatJson, requireReady, type ChatMessage } from './ollama'
import { clock } from './transcript'

/**
 * Ask your library: answer a question from what is said in your downloaded videos. The transcripts are
 * cut into ~45 second passages, the best passages for the question are found with BM25 (no embeddings
 * needed, so it works with any model, local or cloud), and the model answers citing [S1 12:34].
 */

type Emit = (progress: Omit<AiProgress, 'requestId'>) => void

const PASSAGE_SECONDS = 45
const MAX_SOURCES = 10
const PER_VIDEO = 3
const MAX_CONTEXT_CHARS = 26000

const STOPWORDS = new Set(
  ('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing ' +
    'down during each few for from further had has have having he her here hers him his how i if in into is it its itself just me more most my no nor ' +
    'not now of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those ' +
    'through to too under until up very was we were what when where which while who whom why will with would you your yours video videos say said says ' +
    'tell talk talked talks mention mentioned anything something thing things someone anyone does did please know explain explained ever which one')
    .split(' '),
)

/** Scripts written without spaces between words (Chinese, Japanese, Thai...). */
const NO_SPACES = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Thai}\p{sc=Lao}\p{sc=Khmer}\p{sc=Myanmar}]+/gu

/**
 * Search terms of a text: lower case, accents folded, without stop words; English plurals and -ing/-ed
 * folded so "routers" finds "router". Vowel signs stay part of a word (Hindi, Tamil...), and text without
 * spaces becomes overlapping pairs of characters, which is how such text is usually searched.
 */
export function terms(text: string): string[] {
  const out: string[] = []
  ;(fold(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).forEach((token) => {
    const rest = token.replace(NO_SPACES, (run) => {
      const chars = Array.from(run)
      if (chars.length === 1) out.push(run)
      for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i] + chars[i + 1])
      return ' '
    })
    rest.split(' ').forEach((word) => {
      if (word.length > 1 && !STOPWORDS.has(word)) out.push(stem(word))
    })
  })
  return out
}

/** A light English stemmer; update, updates, updated and updating all become "updat". */
export function stem(word: string): string {
  if (!/^[a-z0-9]+$/.test(word)) return word
  let w = word
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) w = w.slice(0, -2)
  else if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1)
  return w
}

interface Passage {
  key: string
  title: string
  videoId: string | null
  start: number
  lines: TranscriptLine[]
  counts: Map<string, number>
  length: number
}

const passageCache = new Map<string, { size: number; passages: Passage[] }>()

function passagesOf(doc: { key: string; title: string; videoId: string | null; lines: TranscriptLine[] }): Passage[] {
  const cached = passageCache.get(doc.key)
  if (cached && cached.size === doc.lines.length) return cached.passages
  const out: Passage[] = []
  let current: TranscriptLine[] = []
  const flush = (): void => {
    if (!current.length) return
    const words = terms(current.map((l) => l.text).join(' ') + ' ' + doc.title)
    const counts = new Map<string, number>()
    words.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 1))
    out.push({ key: doc.key, title: doc.title, videoId: doc.videoId, start: current[0].start, lines: current, counts, length: words.length })
    current = []
  }
  doc.lines.forEach((line) => {
    if (current.length && line.start - current[0].start >= PASSAGE_SECONDS) flush()
    current.push(line)
  })
  flush()
  passageCache.set(doc.key, { size: doc.lines.length, passages: out })
  return out
}

/** BM25 over all passages; at most PER_VIDEO passages from one video. */
export function rank(passages: Passage[], query: string[], limit: number): Passage[] {
  const unique = Array.from(new Set(query))
  if (!unique.length || !passages.length) return []
  const avg = passages.reduce((sum, p) => sum + p.length, 0) / passages.length || 1
  const df = new Map<string, number>()
  unique.forEach((t) => df.set(t, passages.reduce((n, p) => n + (p.counts.has(t) ? 1 : 0), 0)))
  const k1 = 1.2
  const b = 0.75
  const scored = passages
    .map((p) => {
      let score = 0
      unique.forEach((t) => {
        const tf = p.counts.get(t) ?? 0
        if (!tf) return
        const n = df.get(t) ?? 0
        const idf = Math.log(1 + (passages.length - n + 0.5) / (n + 0.5))
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.length) / avg)))
      })
      return { p, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b2) => b2.score - a.score)
  const perVideo = new Map<string, number>()
  const picked: Passage[] = []
  for (const { p } of scored) {
    const used = perVideo.get(p.key) ?? 0
    if (used >= PER_VIDEO) continue
    perVideo.set(p.key, used + 1)
    picked.push(p)
    if (picked.length >= limit) break
  }
  return picked
}

const KEYWORDS_SCHEMA = {
  type: 'object',
  properties: { keywords: { type: 'array', items: { type: 'string' } } },
  required: ['keywords'],
}

const SYSTEM = `You answer questions using passages from the user's own saved videos and podcasts (their transcripts, with [mm:ss] timestamps). Each passage is labeled [S1], [S2], ...

- Answer from the passages. Cite every point right after it as [S2 04:31]: the passage label, a space, and a timestamp that appears in that passage. Cite several passages when they agree or differ.
- Say which video said what when it matters ("In <title>, ..."). Be direct and concise; "- " bullets and **bold** are fine.
- If the passages do not answer the question, say so plainly in one sentence and suggest words to search for instead. Do not make up citations. You may add general knowledge, clearly marked as not from their videos.
- Answer in the language of the question. The transcripts are often automatic captions, so expect recognition errors.`

export async function askLibrary(req: LibraryAskRequest, emit: Emit, signal: AbortSignal): Promise<LibraryAnswer> {
  const model = requireReady()
  const question = String(req.question ?? '').trim()
  if (!question) throw new Error('Type a question first.')
  emit({ stage: 'Searching your transcripts…' })
  const docs = await libraryTranscripts()
  if (!docs.length) throw new Error('Nothing in your library is searchable yet. Click "Make my library searchable" first, then ask again.')
  const passages = docs.flatMap(passagesOf)
  let keywords = terms(question)
  let picked = rank(passages, keywords, MAX_SOURCES)
  if (picked.length < 3) {
    // Few direct hits: let the model suggest the words people would actually say about it.
    emit({ stage: 'Thinking of other ways it might be said…' })
    try {
      const extra = await chatJson<{ keywords?: string[] }>(
        [
          { role: 'system', content: 'You turn a question into search keywords for spoken video transcripts. Reply with JSON {"keywords": [...]}: 6 to 12 single words or short phrases, including synonyms, related terms and the words people would say out loud. Same language as the question.' },
          { role: 'user', content: question },
        ],
        KEYWORDS_SCHEMA,
        { signal, temperature: 0.2 },
      )
      const more = (Array.isArray(extra.keywords) ? extra.keywords : []).flatMap((k) => terms(String(k)))
      keywords = Array.from(new Set([...keywords, ...more]))
      picked = rank(passages, keywords, MAX_SOURCES)
    } catch (err) {
      if (signal.aborted) throw err
    }
  }
  if (!picked.length) {
    return {
      requestId: req.requestId,
      text: 'None of your ' + docs.length + ' searchable videos seem to talk about that. Try other words, or search inside your videos with a single keyword.',
      sources: [],
      keywords,
      model,
    }
  }
  // Keep each video's passages together and in time order, so the model reads them in context.
  picked.sort((a, b) => a.title.localeCompare(b.title) || a.start - b.start)
  const sources: LibrarySource[] = picked.map((p, index) => ({ ref: 'S' + (index + 1), key: p.key, title: p.title, videoId: p.videoId, start: p.start }))
  emit({ sources, stage: 'Reading ' + picked.length + ' passages from ' + new Set(picked.map((p) => p.key)).size + ' videos…' })
  let budget = MAX_CONTEXT_CHARS
  const blocks = picked.map((p, index) => {
    const body = p.lines.map((l) => '[' + clock(l.start) + '] ' + l.text).join('\n')
    const text = '[S' + (index + 1) + '] "' + p.title + '"\n' + body.slice(0, Math.max(400, Math.min(body.length, budget)))
    budget -= text.length
    return text
  })
  const history: ChatMessage[] = (req.history ?? [])
    .slice(-6)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
  const text = await chat(
    [
      { role: 'system', content: SYSTEM + '\n\nPassages from your library:\n\n' + blocks.join('\n\n') },
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
  return { requestId: req.requestId, text, sources, keywords, model }
}
