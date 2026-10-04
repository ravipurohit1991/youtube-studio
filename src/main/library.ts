import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, basename } from 'node:path'
import { shell } from 'electron'
import type { LibraryItem, MediaKind } from '@shared/types'
import { log, logError } from './logger'
import { imageProxyUrl, mediaUrlForPath } from './media-server'
import { settings } from './settings'

const VIDEO_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.3gp', '.ts']
const AUDIO_EXT = ['.mp3', '.m4a', '.opus', '.ogg', '.oga', '.wav', '.flac', '.aac']
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp']
const SIDECAR_INFO = '.info.json'

interface Sidecars {
  info: string | null
  image: string | null
  subs: string[]
}

/** yt-dlp's per-format pieces before merging: "Title [id].f137.mp4", "Title [id].f140-drc.m4a". */
const FORMAT_PART = /(\])\.f[A-Za-z0-9_-]+$/

/** Files yt-dlp/ffmpeg are still writing or left behind; never library items on their own. */
function isWorkFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.part') || lower.endsWith('.ytdl') || /\.part-frag\d+$/.test(lower) || /\.temp\.[a-z0-9]+$/.test(lower)
}

function walk(dir: string, depth: number, out: string[]): void {
  if (depth < 0) return
  let listing: string[] = []
  try {
    listing = readdirSync(dir)
  } catch {
    return
  }
  listing.forEach(function (name) {
    if (name.startsWith('.')) return
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      return
    }
    if (st.isDirectory()) {
      walk(full, depth - 1, out)
      return
    }
    out.push(full)
  })
}

function kindFor(ext: string): MediaKind | null {
  if (VIDEO_EXT.includes(ext)) return 'video'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  return null
}

function titleFromFilename(name: string): string {
  const withoutExt = name.replace(/\.[a-z0-9]{2,4}$/i, '')
  return withoutExt.replace(/\s*\[[A-Za-z0-9_-]{6,}\].*$/, '').trim() || withoutExt
}

function idFromFilename(name: string): string | null {
  const match = /\[([A-Za-z0-9_-]{6,})\]/.exec(name)
  return match ? match[1] : null
}

interface InfoShape {
  id?: string
  title?: string
  uploader?: string
  channel?: string
  duration?: number
  thumbnail?: string
  playlist_title?: string
  playlist_index?: number
}

function readInfo(path: string): InfoShape | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as InfoShape
  } catch (err) {
    logError('library.info', err)
    return null
  }
}

export async function scanLibrary(): Promise<LibraryItem[]> {
  const root = settings.get('downloadsDir')
  if (!existsSync(root)) return []
  const files: string[] = []
  walk(root, 3, files)
  const sidecars = new Map<string, Sidecars>()
  const sidecarFor = function (dir: string, base: string): Sidecars {
    const key = dir + '|' + base
    let found = sidecars.get(key)
    if (!found) {
      found = { info: null, image: null, subs: [] }
      sidecars.set(key, found)
    }
    return found
  }
  // Every media file is its own item (a video and an MP3 of the same title are two items);
  // thumbnails/metadata/subtitles attach to all media sharing their base name.
  const media: Array<{ full: string; dir: string; base: string; ext: string; kind: MediaKind }> = []
  files.forEach(function (full) {
    const dir = join(full, '..')
    const name = basename(full)
    if (isWorkFile(name)) return
    const ext = extname(name).toLowerCase()
    if (ext === '.json') {
      if (name.endsWith(SIDECAR_INFO)) sidecarFor(dir, name.slice(0, name.length - SIDECAR_INFO.length)).info = full
      return
    }
    if (IMAGE_EXT.includes(ext)) {
      const side = sidecarFor(dir, name.slice(0, name.length - ext.length))
      if (!side.image) side.image = full
      return
    }
    if (ext === '.vtt' || ext === '.srt' || ext === '.ass' || ext === '.lrc') {
      sidecarFor(dir, name.replace(/\.[A-Za-z-]{2,7}\.(vtt|srt|ass|lrc)$/i, '')).subs.push(full)
      return
    }
    const kind = kindFor(ext)
    if (!kind) return
    media.push({ full, dir, base: name.slice(0, name.length - ext.length), ext, kind })
  })

  // Separate video/audio pieces only matter when the merged file is missing (merge failed or still
  // running). Then show one entry for them, the video piece, instead of one per format.
  const finals = new Set(media.filter(function (m) { return !FORMAT_PART.test(m.base) }).map(function (m) { return m.dir + '|' + m.base }))
  const orphanShown = new Set<string>()
  const visible = media
    .slice()
    .sort(function (a, b) { return (a.kind === 'video' ? 0 : 1) - (b.kind === 'video' ? 0 : 1) })
    .filter(function (m) {
      if (!FORMAT_PART.test(m.base)) return true
      const key = m.dir + '|' + m.base.replace(FORMAT_PART, '$1')
      if (finals.has(key) || orphanShown.has(key)) return false
      orphanShown.add(key)
      return true
    })

  const items: LibraryItem[] = []
  visible.forEach(function (m) {
    const name = basename(m.full)
    let size = 0
    let mtime = 0
    try {
      const st = statSync(m.full)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      return
    }
    const base = m.base.replace(FORMAT_PART, '$1')
    const side = sidecars.get(m.dir + '|' + base) ?? { info: null, image: null, subs: [] }
    const info = side.info ? readInfo(side.info) : null
    const videoId = info?.id ?? idFromFilename(name)
    const fallbackThumb = videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : null
    const remoteThumb = info?.thumbnail ?? fallbackThumb
    const partial = FORMAT_PART.test(m.base)
    items.push({
      id: m.full,
      name,
      relPath: relative(root, m.full),
      absPath: m.full,
      ext: m.ext.replace('.', ''),
      kind: m.kind,
      size,
      mtime,
      title: (info?.title ?? titleFromFilename(base + m.ext)) + (partial ? ' (incomplete: not merged)' : ''),
      uploader: info?.uploader ?? info?.channel ?? null,
      duration: typeof info?.duration === 'number' ? info.duration : null,
      thumbnailUrl: side.image ? mediaUrlForPath(side.image) : imageProxyUrl(remoteThumb),
      mediaUrl: mediaUrlForPath(m.full),
      videoId,
      subtitleFiles: side.subs.map(function (s) { return basename(s) }),
      isPlaylistPart: typeof info?.playlist_index === 'number' || !!info?.playlist_title,
    })
  })

  const sorted = items.sort(function (a, b) { return b.mtime - a.mtime })
  log('library: found', sorted.length, 'items in', root)
  return sorted
}

/** Move a media file and all of its sidecars to the OS trash. */
export async function deleteLibraryItem(absPath: string): Promise<string[]> {
  const root = settings.get('downloadsDir')
  const dir = join(absPath, '..')
  const name = basename(absPath)
  const ext = extname(name)
  const base = name.slice(0, name.length - ext.length)
  let siblings: string[] = []
  try {
    siblings = readdirSync(dir)
  } catch {
    siblings = []
  }
  const stem = base.replace(FORMAT_PART, '$1')
  const related = siblings.filter(function (candidate) { return candidate !== name && candidate.startsWith(stem + '.') })
  // Another finished media file with the same name (e.g. the MP3 next to the MP4) keeps the shared sidecars.
  const otherMedia = related.some(function (candidate) {
    const candidateExt = extname(candidate).toLowerCase()
    const candidateBase = candidate.slice(0, candidate.length - candidateExt.length)
    return !!kindFor(candidateExt) && candidateBase === stem
  })
  const targets = [absPath]
  related.forEach(function (candidate) {
    const candidateExt = extname(candidate).toLowerCase()
    const candidateBase = candidate.slice(0, candidate.length - candidateExt.length)
    const isPiece = FORMAT_PART.test(candidateBase) || isWorkFile(candidate)
    const isFinalMedia = !!kindFor(candidateExt) && !isPiece
    if (isFinalMedia) return
    if (otherMedia && !isPiece) return
    targets.push(join(dir, candidate))
  })
  const trashed: string[] = []
  for (const target of targets) {
    try {
      const st = statSync(target)
      if (st.size > 4 * 1024 * 1024 * 1024) {
        log('library: skipping huge file in trash', target)
      }
      await shell.trashItem(target)
      trashed.push(target)
    } catch (err) {
      logError('library.trash', err)
    }
  }
  log('library: trashed', trashed.length, 'files from', root)
  return trashed
}
