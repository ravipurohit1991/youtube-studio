import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { InsightSource } from '@shared/types'
import { log, logError } from '../logger'
import { downloadCaptions, infoJson } from '../ytdlp'

/**
 * What the AI reads about one video: its captions as timestamped text (uploaded subtitles first,
 * else YouTube's automatic captions), plus title, description and chapters.
 */

export interface VideoContext {
  source: InsightSource
  description: string
  chapters: { start: number; title: string }[]
  /** "[mm:ss] text" lines, one per ~30 seconds, or '' when the video has no captions. */
  transcript: string
}

interface Cue {
  start: number
  text: string
}

/** Roughly 12k tokens of transcript: plenty for a summary, and fits small local context windows too. */
const MAX_TRANSCRIPT_CHARS = 48000
const cache = new Map<string, VideoContext>()

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : pad(m) + ':' + pad(s)
}

function parseTime(value: string): number {
  const parts = value.trim().split(':').map(Number)
  if (parts.some((n) => isNaN(n))) return 0
  return parts.reduce((sum, n) => sum * 60 + n, 0)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/**
 * WebVTT to cues. YouTube's automatic captions "roll": each cue repeats the previous line and adds
 * a new one, so a line already emitted is skipped.
 */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = []
  const blocks = vtt.replace(/\r/g, '').split(/\n\n+/)
  let last = ''
  blocks.forEach((block) => {
    const lines = block.split('\n')
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing < 0) return
    const start = parseTime(lines[timing].split('-->')[0])
    lines.slice(timing + 1).forEach((raw) => {
      const text = decodeEntities(raw.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
      if (!text || text === last) return
      last = text
      cues.push({ start, text })
    })
  })
  return cues
}

/** Cues grouped into ~30 second "[mm:ss] ..." lines, thinned evenly when the video is very long. */
export function compactTranscript(cues: Cue[]): string {
  if (!cues.length) return ''
  const total = cues.reduce((sum, cue) => sum + cue.text.length + 1, 0)
  // Long videos get longer windows, and each window is cut to its share of the budget.
  const window = total > MAX_TRANSCRIPT_CHARS * 2 ? 90 : total > MAX_TRANSCRIPT_CHARS ? 60 : 30
  const groups: { start: number; text: string }[] = []
  cues.forEach((cue) => {
    const current = groups[groups.length - 1]
    if (current && cue.start - current.start < window) current.text += ' ' + cue.text
    else groups.push({ start: cue.start, text: cue.text })
  })
  const share = Math.max(80, Math.floor(MAX_TRANSCRIPT_CHARS / groups.length) - 10)
  return groups
    .map((g) => '[' + clock(g.start) + '] ' + (g.text.length > share ? g.text.slice(0, share) + '…' : g.text))
    .join('\n')
}

/** Which caption track to use: uploaded English, then the original spoken language, then anything. */
export function pickCaptionTrack(info: Record<string, unknown>): { lang: string; auto: boolean } | null {
  const manual = Object.keys((info.subtitles as Record<string, unknown>) ?? {}).filter((k) => k !== 'live_chat')
  const auto = Object.keys((info.automatic_captions as Record<string, unknown>) ?? {})
  const spoken = (str(info.language) ?? '').toLowerCase()
  const isEn = (k: string): boolean => k === 'en' || k.startsWith('en-')
  const manualEn = manual.find(isEn)
  if (manualEn) return { lang: manualEn, auto: false }
  if (spoken) {
    const own = manual.find((k) => k === spoken || k.startsWith(spoken + '-'))
    if (own) return { lang: own, auto: false }
    const autoOwn = auto.find((k) => k === spoken + '-orig') ?? auto.find((k) => k === spoken)
    if (autoOwn) return { lang: autoOwn, auto: true }
  }
  const orig = auto.find((k) => k.endsWith('-orig'))
  if (orig) return { lang: orig, auto: true }
  if (manual.length) return { lang: manual[0], auto: false }
  const autoEn = auto.find((k) => k === 'en')
  if (autoEn) return { lang: autoEn, auto: true }
  return auto.length ? { lang: auto[0], auto: true } : null
}

export async function videoContext(url: string): Promise<VideoContext> {
  const known = cache.get(url)
  if (known) return known
  const info = await infoJson(url)
  const id = str(info.id) ?? url
  const hit = cache.get(id)
  if (hit) {
    cache.set(url, hit)
    return hit
  }
  if (info._type === 'playlist') throw new Error('That is a playlist. Open a single video to summarize it.')

  const track = pickCaptionTrack(info)
  let transcript = ''
  if (track) {
    const dir = mkdtempSync(join(tmpdir(), 'ytd-captions-'))
    try {
      const file = await downloadCaptions(str(info.webpage_url) ?? url, track.lang, track.auto, dir)
      if (file) transcript = compactTranscript(parseVtt(readFileSync(file, 'utf8')))
    } catch (err) {
      logError('ai.captions', err)
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* temp cleanup is best effort */
      }
    }
  }
  log('ai: transcript for ' + id + ': ' + (transcript ? transcript.length + ' chars (' + track?.lang + (track?.auto ? ', auto' : '') + ')' : 'none'))

  const chapters = Array.isArray(info.chapters)
    ? (info.chapters as Record<string, unknown>[])
        .map((c) => ({ start: typeof c.start_time === 'number' ? c.start_time : 0, title: str(c.title) ?? '' }))
        .filter((c) => c.title)
    : []
  const context: VideoContext = {
    source: {
      videoId: id,
      title: str(info.title) ?? 'Untitled',
      channel: str(info.channel) ?? str(info.uploader),
      duration: typeof info.duration === 'number' ? info.duration : null,
      language: transcript && track ? track.lang : null,
      autoCaptions: !!transcript && !!track?.auto,
    },
    description: (str(info.description) ?? '').slice(0, 4000),
    chapters,
    transcript,
  }
  cache.set(id, context)
  cache.set(url, context)
  while (cache.size > 40) cache.delete(cache.keys().next().value as string)
  return context
}

/** The video as one block of prompt text. */
export function contextText(ctx: VideoContext): string {
  const parts = [
    'Title: ' + ctx.source.title,
    'Channel: ' + (ctx.source.channel ?? 'unknown'),
    'Length: ' + (ctx.source.duration ? clock(ctx.source.duration) : 'unknown'),
  ]
  if (ctx.chapters.length) parts.push('Chapters:\n' + ctx.chapters.map((c) => '[' + clock(c.start) + '] ' + c.title).join('\n'))
  if (ctx.description) parts.push('Description:\n' + ctx.description)
  parts.push(
    ctx.transcript
      ? 'Transcript (' + (ctx.source.autoCaptions ? 'automatic captions, may contain recognition errors' : 'captions') + ', language ' + ctx.source.language + '):\n' + ctx.transcript
      : 'Transcript: not available for this video. Work from the title, chapters and description, and say so.',
  )
  return parts.join('\n\n')
}
