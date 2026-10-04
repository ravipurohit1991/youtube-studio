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

interface Group {
  dir: string
  base: string
  media: string | null
  info: string | null
  image: string | null
  subs: string[]
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
  const groups = new Map<string, Group>()
  const getGroup = function (dir: string, base: string): Group {
    const key = dir + '|' + base
    const existing = groups.get(key)
    if (existing) return existing
    const created: Group = { dir, base, media: null, info: null, image: null, subs: [] }
    groups.set(key, created)
    return created
  }
  files.forEach(function (full) {
    const dir = join(full, '..')
    const name = basename(full)
    const ext = extname(name).toLowerCase()
    if (ext === '.json') {
      if (name.endsWith(SIDECAR_INFO)) {
        const base = name.slice(0, name.length - SIDECAR_INFO.length)
        getGroup(dir, base).info = full
      }
      return
    }
    if (IMAGE_EXT.includes(ext)) {
      const base = name.slice(0, name.length - ext.length)
      const group = getGroup(dir, base)
      if (!group.image) group.image = full
      return
    }
    if (ext === '.vtt' || ext === '.srt' || ext === '.ass' || ext === '.lrc') {
      const base = name.replace(/\.[A-Za-z-]{2,7}\.(vtt|srt|ass|lrc)$/i, '')
      getGroup(dir, base).subs.push(full)
      return
    }
    const kind = kindFor(ext)
    if (!kind) return
    const base = name.slice(0, name.length - ext.length)
    getGroup(dir, base).media = full
  })

  const items: LibraryItem[] = []
  groups.forEach(function (group) {
    if (!group.media) return
    const name = basename(group.media)
    const ext = extname(name).toLowerCase().replace('.', '')
    const kind = kindFor('.' + ext)
    if (!kind) return
    let size = 0
    let mtime = 0
    try {
      const st = statSync(group.media)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      return
    }
    const info = group.info ? readInfo(group.info) : null
    const videoId = info?.id ?? idFromFilename(name)
    const fallbackThumb = videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : null
    const remoteThumb = info?.thumbnail ?? fallbackThumb
    items.push({
      id: group.media,
      name,
      relPath: relative(root, group.media),
      absPath: group.media,
      ext,
      kind,
      size,
      mtime,
      title: info?.title ?? titleFromFilename(name),
      uploader: info?.uploader ?? info?.channel ?? null,
      duration: typeof info?.duration === 'number' ? info.duration : null,
      thumbnailUrl: group.image ? mediaUrlForPath(group.image) : imageProxyUrl(remoteThumb),
      mediaUrl: mediaUrlForPath(group.media),
      videoId,
      subtitleFiles: group.subs.map(function (s) { return basename(s) }),
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
  const targets = [absPath]
  siblings.forEach(function (candidate) {
    if (candidate === name) return
    if (candidate.startsWith(base + '.')) {
      if (candidate.endsWith(SIDECAR_INFO) || candidate.startsWith(base + '.') ) {
        const full = join(dir, candidate)
        if (!targets.includes(full)) targets.push(full)
      }
    }
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
