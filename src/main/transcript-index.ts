import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { LibraryItem, Transcript, TranscriptHit, TranscriptIndexStatus, TranscriptLine, TranscriptMatch, TranscriptSearchResult } from '@shared/types'
import { IPC } from '@shared/ipc'
import { fetchCaptions, onCaptions, parseVtt, type CaptionTrack } from './ai/transcript'
import { broadcast } from './bus'
import { extractVideoId } from './downloads'
import { cachedLibrary, infoJsonPath, scanLibrary } from './library'
import { log, logError } from './logger'
import { userDataDir } from './paths'
import { infoJson, resolveYtdlp } from './ytdlp'

/**
 * What is said in every library item, kept as timestamped lines so it can be searched ("which video
 * mentioned X, and when?"), shown next to the player, and handed to the AI. Lines come from subtitle
 * files next to a download, else from the video's captions on YouTube (fetched once, in the background).
 *
 * transcripts/index.json maps library keys to a transcript file (one per YouTube video, shared by its
 * MP4 and MP3) or records that the item has no captions.
 */

interface Entry {
  file: string | null
  status: 'ok' | 'none' | 'error'
  at: number
  title: string
  videoId: string | null
  kind: 'video' | 'audio' | 'stream'
}

interface Manifest {
  v: 1
  items: Record<string, Entry>
}

interface StoredTranscript {
  v: 1
  videoId: string | null
  lang: string | null
  auto: boolean
  source: Transcript['source']
  lines: [number, string][]
}

/** A transcript prepared for search: lower case, accents folded. */
interface Searchable {
  file: string
  lines: TranscriptLine[]
  folded: string[]
}

/** Failed reads (offline, rate limited) are retried, but not on every search or panel open. */
const RETRY_AFTER = 6 * 3600 * 1000
const CONCURRENCY = 2

let manifest: Manifest | null = null
let saveTimer: NodeJS.Timeout | null = null
const loaded = new Map<string, Searchable | null>()
const inflight = new Map<string, Promise<Transcript | null>>()
let run: { canceled: boolean; done: number; queued: number; current: string | null } | null = null
let statusTimer: NodeJS.Timeout | null = null
const wanted = new Set<string>()
let wantedTimer: NodeJS.Timeout | null = null

function dir(): string {
  const path = join(userDataDir(), 'transcripts')
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
  return path
}

function data(): Manifest {
  if (manifest) return manifest
  manifest = { v: 1, items: {} }
  try {
    const file = join(dir(), 'index.json')
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Manifest>
      if (raw && raw.items && typeof raw.items === 'object') manifest.items = raw.items
    }
  } catch (err) {
    logError('transcripts.load', err)
  }
  return manifest
}

function persist(): void {
  if (saveTimer) return
  saveTimer = setTimeout(function () {
    saveTimer = null
    flushTranscripts()
  }, 500)
}

export function flushTranscripts(): void {
  if (!manifest) return
  try {
    const file = join(dir(), 'index.json')
    writeFileSync(file + '.tmp', JSON.stringify(manifest), 'utf8')
    renameSync(file + '.tmp', file)
  } catch (err) {
    logError('transcripts.save', err)
  }
}

function validId(id: string | null | undefined): id is string {
  return !!id && /^[\w-]{6,}$/.test(id)
}

function fileFor(key: string, videoId: string | null): string {
  if (validId(videoId)) return 'yt-' + videoId + '.json'
  return 'f-' + createHash('sha1').update(key).digest('hex').slice(0, 16) + '.json'
}

function readStored(file: string): StoredTranscript | null {
  try {
    const path = join(dir(), basename(file))
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf8')) as StoredTranscript
    return raw && Array.isArray(raw.lines) ? raw : null
  } catch (err) {
    logError('transcripts.read', err)
    return null
  }
}

function toTranscript(stored: StoredTranscript): Transcript {
  return {
    videoId: stored.videoId,
    lang: stored.lang,
    auto: !!stored.auto,
    source: stored.source,
    lines: stored.lines.map(function (l) { return { start: l[0], text: l[1] } }),
  }
}

function writeStored(file: string, transcript: Transcript): void {
  const stored: StoredTranscript = {
    v: 1,
    videoId: transcript.videoId,
    lang: transcript.lang,
    auto: transcript.auto,
    source: transcript.source,
    lines: transcript.lines.map(function (l) { return [Math.round(l.start * 100) / 100, l.text] as [number, string] }),
  }
  const path = join(dir(), file)
  writeFileSync(path + '.tmp', JSON.stringify(stored), 'utf8')
  renameSync(path + '.tmp', path)
  loaded.delete(file)
}

function setEntry(key: string, entry: Entry): void {
  data().items[key] = entry
  persist()
}

export function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ')
}

function trackToTranscript(track: CaptionTrack, source: Transcript['source']): Transcript {
  return {
    videoId: track.videoId || null,
    lang: track.lang,
    auto: track.auto,
    source,
    lines: track.cues.map(function (c) { return { start: c.start, text: c.text } }),
  }
}

// Captions fetched for an AI summary are kept too: the Stream tab and the library then have them for free.
onCaptions(function (track) {
  if (!validId(track.videoId)) return
  const file = fileFor('', track.videoId)
  try {
    if (!existsSync(join(dir(), file))) writeStored(file, trackToTranscript(track, 'youtube'))
    setEntry('yt:' + track.videoId, { file, status: 'ok', at: Date.now(), title: track.videoId, videoId: track.videoId, kind: 'stream' })
  } catch (err) {
    logError('transcripts.remember', err)
  }
})

/** Subtitle files next to the download, English first. */
function localSubtitle(item: LibraryItem): string | null {
  const files = item.subtitleFiles.filter(function (name) { return /\.(vtt|srt)$/i.test(name) })
  if (!files.length) return null
  const english = files.find(function (name) { return /\.en([.-][\w-]+)?\.(vtt|srt)$/i.test(name) })
  return join(item.absPath, '..', english ?? files[0])
}

function langOf(path: string): string | null {
  const match = /\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\.(srt|vtt)$/i.exec(path)
  return match ? match[1] : null
}

function ytdlpAvailable(): boolean {
  return resolveYtdlp().source !== 'missing'
}

/** Read one library item's transcript: stored, subtitle file, or YouTube captions. */
async function readItem(item: LibraryItem): Promise<Transcript | null> {
  const videoId = validId(item.videoId) ? item.videoId : null
  const file = fileFor(item.key, videoId)
  const base = { title: item.title ?? item.name, videoId, kind: item.kind } as const
  const existing = readStored(file)
  if (existing) {
    setEntry(item.key, { ...base, file, status: 'ok', at: Date.now() })
    return toTranscript(existing)
  }
  const sub = localSubtitle(item)
  if (sub) {
    try {
      const cues = parseVtt(readFileSync(sub, 'utf8'))
      if (cues.length) {
        const transcript: Transcript = { videoId, lang: langOf(sub), auto: false, source: 'subtitles', lines: cues }
        writeStored(file, transcript)
        setEntry(item.key, { ...base, file, status: 'ok', at: Date.now() })
        return transcript
      }
    } catch (err) {
      logError('transcripts.subtitle', err)
    }
  }
  if (!videoId) {
    setEntry(item.key, { ...base, file: null, status: 'none', at: Date.now() })
    return null
  }
  // Not "no captions": the item stays unread and is tried again once yt-dlp is there (first start).
  if (!ytdlpAvailable()) throw new Error('yt-dlp is not installed yet, so the captions cannot be read.')
  const url = 'https://www.youtube.com/watch?v=' + videoId
  try {
    // The .info.json saved with the download lists the caption tracks, which saves asking YouTube twice.
    let info: Record<string, unknown> | null = null
    const sidecar = infoJsonPath(item.absPath)
    if (sidecar) {
      try {
        const parsed = JSON.parse(readFileSync(sidecar, 'utf8')) as Record<string, unknown>
        if (parsed && (parsed.subtitles || parsed.automatic_captions)) info = parsed
      } catch {
        info = null
      }
    }
    if (!info) info = await infoJson(url)
    const track = await fetchCaptions({ ...info, id: videoId }, url)
    if (!track) {
      setEntry(item.key, { ...base, file: null, status: 'none', at: Date.now() })
      return null
    }
    const transcript = trackToTranscript(track, 'youtube')
    writeStored(file, transcript)
    setEntry(item.key, { ...base, file, status: 'ok', at: Date.now() })
    return transcript
  } catch (err) {
    logError('transcripts.fetch', err)
    setEntry(item.key, { ...base, file: null, status: 'error', at: Date.now() })
    throw err
  }
}

function once(id: string, work: () => Promise<Transcript | null>): Promise<Transcript | null> {
  const running = inflight.get(id)
  if (running) return running
  const promise = work().finally(function () { inflight.delete(id) })
  inflight.set(id, promise)
  return promise
}

/**
 * readItem, shared by items of the same video: the MP4 and MP3 of one video read the captions once, and
 * both are recorded.
 */
async function readShared(item: LibraryItem): Promise<Transcript | null> {
  const videoId = validId(item.videoId) ? item.videoId : null
  const result = await once(videoId ?? item.key, function () { return readItem(item) })
  const file = fileFor(item.key, videoId)
  setEntry(item.key, {
    file: result ? file : null,
    status: result ? 'ok' : 'none',
    at: Date.now(),
    title: item.title ?? item.name,
    videoId,
    kind: item.kind,
  })
  return result
}

function needsWork(item: LibraryItem): boolean {
  const entry = data().items[item.key]
  if (!entry) return true
  if (entry.status === 'error') return Date.now() - entry.at > RETRY_AFTER
  if (entry.status === 'ok') return !entry.file || !existsSync(join(dir(), entry.file))
  return false
}

async function library(): Promise<LibraryItem[]> {
  return cachedLibrary() ?? scanLibrary()
}

export async function transcriptStatus(): Promise<TranscriptIndexStatus> {
  const items = await library()
  const entries = data().items
  let indexed = 0
  let missing = 0
  items.forEach(function (item) {
    const entry = entries[item.key]
    if (entry?.status === 'ok') indexed += 1
    else if (entry?.status === 'none') missing += 1
  })
  return {
    total: items.length,
    indexed,
    missing,
    pending: items.length - indexed - missing,
    running: !!run,
    current: run?.current ?? null,
    done: run?.done ?? 0,
    queued: run?.queued ?? 0,
  }
}

function announce(now = false): void {
  const send = function (): void {
    statusTimer = null
    void transcriptStatus().then(function (status) { broadcast(IPC.transcriptStatusChanged, status) }).catch(function () { return undefined })
  }
  if (now) {
    if (statusTimer) clearTimeout(statusTimer)
    send()
    return
  }
  if (!statusTimer) statusTimer = setTimeout(send, 300)
}

/** Read the captions of every item that has none yet, two at a time. Returns at once; progress is broadcast. */
export async function startIndexing(only?: (item: LibraryItem) => boolean): Promise<TranscriptIndexStatus> {
  if (run) return transcriptStatus()
  const items = (await scanLibrary()).filter(function (item) { return needsWork(item) && (!only || only(item)) })
  if (!items.length) return transcriptStatus()
  const state = { canceled: false, done: 0, queued: items.length, current: null as string | null }
  run = state
  log('transcripts: indexing', items.length, 'items')
  const queue = items.slice()
  let failures = 0
  const worker = async function (): Promise<void> {
    while (queue.length && !state.canceled) {
      const item = queue.shift() as LibraryItem
      state.current = item.title ?? item.name
      announce()
      try {
        await readShared(item)
        failures = 0
      } catch {
        failures += 1
        // Offline or blocked: stop instead of failing the whole library one by one.
        if (failures >= 4) state.canceled = true
      }
      state.done += 1
      announce()
    }
  }
  void Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(function () {
    run = null
    log('transcripts: indexed', state.done, 'of', state.queued, state.canceled ? '(stopped)' : '')
    announce(true)
  })
  return transcriptStatus()
}

export async function cancelIndexing(): Promise<TranscriptIndexStatus> {
  if (run) run.canceled = true
  return transcriptStatus()
}

/** A download finished: make it searchable soon (when that is switched on). */
export function indexSoon(absPath: string): void {
  wanted.add(absPath)
  if (wantedTimer) clearTimeout(wantedTimer)
  wantedTimer = setTimeout(function () {
    wantedTimer = null
    if (run) {
      // Try again once the current run is over.
      indexSoon(absPath)
      return
    }
    const paths = new Set(wanted)
    wanted.clear()
    void startIndexing(function (item) { return paths.has(item.absPath) }).catch(function (err) { logError('transcripts.indexSoon', err) })
  }, 4000)
}

/** The transcript of a library item, read now when it is not indexed yet. */
export async function transcriptFor(key: string): Promise<Transcript | null> {
  const entry = data().items[key]
  if (entry?.status === 'ok' && entry.file) {
    const stored = readStored(entry.file)
    if (stored) return toTranscript(stored)
  }
  const items = await library()
  let item = items.find(function (i) { return i.key === key })
  if (!item) item = (await scanLibrary()).find(function (i) { return i.key === key })
  if (!item) throw new Error('That file is no longer in the library.')
  // Checked before and nothing there. (A failed check is retried: opening the panel asks for it.)
  if (entry?.status === 'none') return null
  const result = await readShared(item)
  announce()
  return result
}

/** The transcript of any YouTube video, for the Stream tab. */
export async function transcriptForUrl(url: string): Promise<Transcript | null> {
  const videoId = extractVideoId(url)
  if (validId(videoId)) {
    const stored = readStored(fileFor('', videoId))
    if (stored) return toTranscript(stored)
    const entry = data().items['yt:' + videoId]
    if (entry && entry.status === 'none' && Date.now() - entry.at < RETRY_AFTER) return null
  }
  return once('url:' + (videoId ?? url), async function () {
    const info = await infoJson(url)
    const id = typeof info.id === 'string' ? info.id : videoId
    const track = await fetchCaptions(info, url)
    if (!validId(id)) return track ? trackToTranscript(track, 'youtube') : null
    if (!track) {
      setEntry('yt:' + id, { file: null, status: 'none', at: Date.now(), title: String(info.title ?? id), videoId: id, kind: 'stream' })
      return null
    }
    // fetchCaptions already stored it (see onCaptions); read it back in the stored shape.
    const stored = readStored(fileFor('', id))
    return stored ? toTranscript(stored) : trackToTranscript(track, 'youtube')
  })
}

/** A library item went to the trash. Its transcript file stays while another item (or a stream) uses it. */
export function forgetTranscript(key: string): void {
  if (!data().items[key]) return
  delete data().items[key]
  persist()
  announce()
}

function searchable(file: string): Searchable | null {
  if (loaded.has(file)) return loaded.get(file) ?? null
  const stored = readStored(file)
  const value = stored
    ? { file, lines: stored.lines.map(function (l) { return { start: l[0], text: l[1] } }), folded: stored.lines.map(function (l) { return fold(l[1]) }) }
    : null
  loaded.set(file, value)
  return value
}

/** Words and "quoted phrases", lower case with accents folded. */
export function parseQuery(query: string): { phrases: string[]; words: string[] } {
  const phrases: string[] = []
  const rest = fold(query).replace(/"([^"]+)"/g, function (_m, phrase: string) {
    const clean = phrase.trim()
    if (clean) phrases.push(clean)
    return ' '
  })
  const words = rest
    .split(/\s+/)
    .map(function (w) { return w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') })
    .filter(function (w) { return w.length > 0 })
  return { phrases, words: Array.from(new Set(words)) }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** One regex per term: it must start a word ("run" finds "running", not "rerun"). */
function termMatchers(query: { phrases: string[]; words: string[] }): RegExp[] {
  return [...query.phrases, ...query.words].map(function (term) {
    return new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRegex(term).replace(/\s+/g, '\\s+'), 'u')
  })
}

interface Candidate {
  key: string
  entry: Entry
}

/** The searchable library items, one per transcript (an MP4 and its MP3 share one; the video wins). */
function candidates(keys: Set<string> | null): Candidate[] {
  const byFile = new Map<string, Candidate>()
  Object.entries(data().items).forEach(function ([key, entry]) {
    if (entry.status !== 'ok' || !entry.file || entry.kind === 'stream') return
    if (keys && !keys.has(key)) return
    const known = byFile.get(entry.file)
    if (!known || (known.entry.kind !== 'video' && entry.kind === 'video')) byFile.set(entry.file, { key, entry })
  })
  return Array.from(byFile.values())
}

/** Find where something is said across the library. */
export async function searchTranscripts(query: string, limit = 40): Promise<TranscriptSearchResult> {
  const started = Date.now()
  const parsed = parseQuery(query)
  const terms = [...parsed.phrases, ...parsed.words]
  const empty: TranscriptSearchResult = { query, terms, matches: [], totalHits: 0, searched: 0, elapsedMs: 0 }
  if (!terms.length) return empty
  const matchers = termMatchers(parsed)
  const items = cachedLibrary()
  const keys = items ? new Set(items.map(function (i) { return i.key })) : null
  const titles = new Map((items ?? []).map(function (i) { return [i.key, i.title ?? i.name] as [string, string] }))
  const pool = candidates(keys)
  const scored: Array<TranscriptMatch & { score: number }> = []
  let totalHits = 0
  pool.forEach(function (candidate) {
    const doc = searchable(candidate.entry.file as string)
    if (!doc) return
    const hits: Array<TranscriptHit & { weight: number }> = []
    for (let i = 0; i < doc.folded.length; i += 1) {
      const single = doc.folded[i]
      // A phrase can run over two caption lines, so each line is also tried together with the next.
      const pair = i + 1 < doc.folded.length ? single + ' ' + doc.folded[i + 1] : single
      if (!matchers.every(function (m) { return m.test(pair) })) continue
      const inOne = matchers.every(function (m) { return m.test(single) })
      if (!inOne && i + 1 < doc.folded.length && matchers.every(function (m) { return m.test(doc.folded[i + 1]) })) continue
      const text = inOne ? doc.lines[i].text : doc.lines[i].text + ' ' + doc.lines[i + 1].text
      hits.push({ start: doc.lines[i].start, text, weight: inOne ? 2 : 1 })
      if (!inOne) i += 1
    }
    if (!hits.length) return
    totalHits += hits.length
    const best = hits
      .slice()
      .sort(function (a, b) { return b.weight - a.weight || a.start - b.start })
      .slice(0, 8)
      .sort(function (a, b) { return a.start - b.start })
    scored.push({
      key: candidate.key,
      title: titles.get(candidate.key) ?? candidate.entry.title,
      videoId: candidate.entry.videoId,
      hits: best.map(function (h) { return { start: h.start, text: h.text } }),
      total: hits.length,
      score: hits.reduce(function (sum, h) { return sum + h.weight }, 0),
    })
  })
  scored.sort(function (a, b) { return b.score - a.score || a.title.localeCompare(b.title) })
  return {
    query,
    terms,
    matches: scored.slice(0, Math.max(1, Math.min(200, limit))).map(function ({ score, ...match }) { return match }),
    totalHits,
    searched: pool.length,
    elapsedMs: Date.now() - started,
  }
}

/** Every indexed transcript in the library with its title, for the AI to search through. */
export async function libraryTranscripts(): Promise<Array<{ key: string; title: string; videoId: string | null; lines: TranscriptLine[] }>> {
  const items = await library()
  const keys = new Set(items.map(function (i) { return i.key }))
  const titles = new Map(items.map(function (i) { return [i.key, i.title ?? i.name] as [string, string] }))
  return candidates(keys)
    .map(function (c) {
      const doc = searchable(c.entry.file as string)
      return doc ? { key: c.key, title: titles.get(c.key) ?? c.entry.title, videoId: c.entry.videoId, lines: doc.lines } : null
    })
    .filter(function (x): x is { key: string; title: string; videoId: string | null; lines: TranscriptLine[] } { return !!x })
}
