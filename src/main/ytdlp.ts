import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { FormatInfo, ToolStatus, UpdateStatus, VideoCodec, VideoMeta, PlaylistEntry, YtdlpUpdateInfo } from '@shared/types'
import { log, logError } from './logger'
import { binDir, ensureDir } from './paths'
import { settings } from './settings'

const RELEASES_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'
const isWin = process.platform === 'win32'

export function exeName(base: string): string {
  return isWin ? base + '.exe' : base
}

export function findOnPath(exe: string): string | null {
  try {
    const probe = isWin ? 'where' : 'which'
    const res = spawnSync(probe, [exe], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    if (res.status !== 0 || !res.stdout) return null
    const first = res.stdout.split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean)[0]
    if (first && existsSync(first)) return first
    return null
  } catch {
    return null
  }
}

function isFile(p: string): boolean {
  try {
    return !!p && existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

export interface ResolvedBinary {
  path: string
  source: 'settings' | 'bundled' | 'path' | 'missing'
}

let cached: { path: string; source: ResolvedBinary['source'] } | null = null

export function invalidateBinary(): void {
  cached = null
}

export function resolveYtdlp(): ResolvedBinary {
  if (cached && (cached.source === 'missing' || isFile(cached.path))) return cached
  const override = settings.get('ytdlpPath').trim()
  if (override && isFile(override)) {
    cached = { path: override, source: 'settings' }
    return cached
  }
  const name = exeName('yt-dlp')
  const managed = join(binDir(), name)
  if (isFile(managed)) {
    cached = { path: managed, source: 'bundled' }
    return cached
  }
  const onPath = findOnPath(isWin ? 'yt-dlp.exe' : 'yt-dlp')
  if (onPath) {
    cached = { path: onPath, source: 'path' }
    return cached
  }
  cached = { path: '', source: 'missing' }
  return cached
}

export async function ytdlpVersion(): Promise<string | null> {
  const bin = resolveYtdlp()
  if (!bin.path) return null
  const res = await runYtdlp(['--version'], { timeoutMs: 20000 })
  if (!res.ok) return null
  const version = res.stdout.trim().split(/\r?\n/)[0] || null
  // --js-runtimes / --remote-components exist since 2025.11; an older custom copy would reject them.
  knownOldYtdlp = !!version && /^\d{4}\./.test(version) && compareVersions(version, '2025.11.12') < 0
  return version
}

let knownOldYtdlp = false

export async function ytdlpStatus(): Promise<ToolStatus> {
  const bin = resolveYtdlp()
  if (!bin.path) {
    return {
      path: null,
      version: null,
      source: 'missing',
      ok: false,
      hint: 'yt-dlp was not found. Use "Install / update yt-dlp" to download it automatically.',
    }
  }
  const version = await ytdlpVersion()
  return {
    path: bin.path,
    version: version,
    source: bin.source,
    ok: !!version,
    hint: version ? null : 'yt-dlp was found but did not respond to --version.',
  }
}

export interface LatestRelease {
  tag: string
  name: string
  url: string
  size: number
}

/** Resolve the newest yt-dlp release asset for this platform. */
export async function fetchLatestRelease(): Promise<LatestRelease> {
  const assetName = isWin ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp'
  const response = await fetch(RELEASES_API, {
    headers: { 'User-Agent': 'YTD-Studio', Accept: 'application/vnd.github+json' },
  })
  if (!response.ok) {
    const suffix = response.status === 403 ? ' (GitHub rate limit reached, try again later)' : ''
    throw new Error('GitHub API responded with ' + response.status + suffix)
  }
  const release = (await response.json()) as {
    tag_name?: string
    assets?: { name: string; browser_download_url: string; size: number }[]
  }
  const asset = (release.assets ?? []).find(function (a) { return a.name === assetName })
  if (!asset) throw new Error('Release did not contain ' + assetName)
  return { tag: release.tag_name ?? '', name: asset.name, url: asset.browser_download_url, size: asset.size || 0 }
}

/** yt-dlp versions are release dates (2026.08.19), so compare them segment by segment. */
export function compareVersions(a: string, b: string): number {
  const segments = function (value: string): number[] {
    return value
      .split('.')
      .map(function (piece) { return parseInt(piece.replace(/[^0-9]/g, ''), 10) })
      .filter(function (n) { return !isNaN(n) })
  }
  const left = segments(a)
  const right = segments(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const x = left[index] ?? 0
    const y = right[index] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

let updateCache: YtdlpUpdateInfo | null = null
const UPDATE_TTL = 30 * 60 * 1000

export function clearUpdateCache(): void {
  updateCache = null
}

/** Compare the installed yt-dlp against the newest GitHub release. */
export async function checkYtdlpUpdate(force?: boolean): Promise<YtdlpUpdateInfo> {
  if (!force && updateCache && Date.now() - updateCache.checkedAt < UPDATE_TTL) return updateCache
  const current = await ytdlpVersion()
  try {
    const release = await fetchLatestRelease()
    updateCache = {
      current,
      latest: release.tag,
      updateAvailable: !current || compareVersions(release.tag, current) > 0,
      error: null,
      checkedAt: Date.now(),
    }
  } catch (err) {
    updateCache = {
      current,
      latest: null,
      updateAvailable: false,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    }
  }
  return updateCache
}

/** Download the latest yt-dlp release binary into the app data folder. */
export async function installYtdlp(onProgress: (s: UpdateStatus) => void): Promise<ToolStatus> {
  ensureDir(binDir())
  onProgress({ phase: 'checking', percent: 0, message: 'Contacting GitHub for the latest yt-dlp release...' })
  const release = await fetchLatestRelease()
  const target = join(binDir(), exeName('yt-dlp'))
  const partial = target + '.part'
  const total = release.size
  const dl = await fetch(release.url, { headers: { 'User-Agent': 'YTD-Studio' } })
  if (!dl.ok || !dl.body) throw new Error('Download failed with ' + dl.status)
  let received = 0
  let lastReport = 0
  const body = Readable.fromWeb(dl.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', function (chunk: Buffer) {
    received += chunk.length
    const now = Date.now()
    if (now - lastReport > 400) {
      lastReport = now
      onProgress({
        phase: 'downloading',
        percent: total ? Math.min(100, Math.round((received / total) * 100)) : 0,
        message: 'Downloading yt-dlp ' + release.tag + '...',
      })
    }
  })
  await pipeline(body, (await import('node:fs')).createWriteStream(partial))
  if (isFile(target)) {
    try {
      unlinkSync(target)
    } catch {
      /* ignore */
    }
  }
  renameSync(partial, target)
  if (!isWin) {
    try {
      chmodSync(target, 0o755)
    } catch {
      /* ignore */
    }
  }
  try {
    writeFileSync(join(binDir(), 'yt-dlp.version'), release.tag, 'utf8')
  } catch {
    /* ignore */
  }
  invalidateBinary()
  cached = null
  clearUpdateCache()
  const status = await ytdlpStatus()
  onProgress({ phase: 'done', percent: 100, message: 'yt-dlp ' + (status.version ?? release.tag) + ' installed.' })
  return status
}

export interface RunOptions {
  timeoutMs?: number
  onLine?: (line: string) => void
  onSpawn?: (child: import('node:child_process').ChildProcess) => void
}

export interface RunResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

export function runYtdlp(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const bin = resolveYtdlp()
  return new Promise<RunResult>(function (resolve) {
    if (!bin.path) {
      resolve({ ok: false, code: null, stdout: '', stderr: 'yt-dlp executable not found' })
      return
    }
    let child: import('node:child_process').ChildProcess
    try {
      child = spawn(bin.path, args, { windowsHide: true, env: ytdlpEnv() })
    } catch (err) {
      logError('ytdlp.spawn', err)
      resolve({ ok: false, code: null, stdout: '', stderr: String(err) })
      return
    }
    if (opts.onSpawn) opts.onSpawn(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    let buffer = ''
    const timer = opts.timeoutMs
      ? setTimeout(function () {
          log('ytdlp timeout, killing', bin.path)
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }, opts.timeoutMs)
      : null
    child.stdout?.on('data', function (chunk: Buffer) {
      const text = chunk.toString('utf8')
      stdout += text
      if (opts.onLine) {
        buffer += text
        const parts = buffer.split(/\r?\n/)
        buffer = parts.pop() ?? ''
        parts.forEach(function (line) { if (line.trim()) opts.onLine!(line) })
      }
    })
    child.stderr?.on('data', function (chunk: Buffer) {
      stderr += chunk.toString('utf8')
    })
    child.on('error', function (err) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      logError('ytdlp.error', err)
      resolve({ ok: false, code: null, stdout: stdout, stderr: stderr || String(err) })
    })
    child.on('close', function (code) {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (opts.onLine && buffer.trim()) opts.onLine(buffer)
      resolve({ ok: code === 0, code: code, stdout: stdout, stderr: stderr })
    })
  })
}

export function cookieArgs(): string[] {
  const browser = settings.get('cookiesFromBrowser')
  return browser ? ['--cookies-from-browser', browser] : []
}

export function proxyArgs(): string[] {
  const proxy = settings.get('proxy').trim()
  return proxy ? ['--proxy', proxy] : []
}

/**
 * YouTube needs a JavaScript runtime to solve its player challenges. Without one yt-dlp falls back to a
 * single limited client: many formats go missing and most of what is left is HLS, which a <video>
 * element cannot play. Electron already contains Node, so point yt-dlp at our own executable and run
 * it in plain-Node mode (ELECTRON_RUN_AS_NODE, see ytdlpEnv). No extra download needed.
 */
export function jsRuntimeArgs(): string[] {
  if (knownOldYtdlp) return []
  return ['--js-runtimes', 'node:' + process.execPath, '--remote-components', 'ejs:github']
}

/** Environment for every yt-dlp child: Node mode for the JS runtime above, UTF-8 output for titles. */
export function ytdlpEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
}

export function baseArgs(): string[] {
  return ['--ignore-config', '--no-colors', ...jsRuntimeArgs(), ...cookieArgs(), ...proxyArgs()]
}

/** Run yt-dlp in JSON dump mode and parse the result. */
async function runJson(args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  const res = await runYtdlp(args, { timeoutMs: timeoutMs })
  const text = res.stdout.trim()
  if (!text) {
    throw new Error(cleanError(res.stderr) || 'yt-dlp returned no data (exit code ' + res.code + ')')
  }
  try {
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(cleanError(res.stderr) || 'Could not parse yt-dlp output')
  }
}

export function cleanError(raw: string): string {
  const lines = raw.split(/\r?\n/).map(function (l) { return l.replace(/^\s*ERROR:\s*/i, '').trim() }).filter(Boolean)
  const meaningful = lines.filter(function (l) { return !l.startsWith('WARNING') && !l.startsWith('Deprecated') })
  return meaningful.slice(-3).join(' | ')
}

function num(value: unknown): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isRealCodec(codec: unknown): boolean {
  return typeof codec === 'string' && codec !== 'none'
}

export function toFormatInfo(raw: Record<string, unknown>): FormatInfo | null {
  const formatId = str(raw.format_id)
  if (!formatId) return null
  const ext = str(raw.ext) ?? ''
  const note = str(raw.format_note)
  if (ext === 'mhtml' || (note && note.toLowerCase().indexOf('storyboard') >= 0)) return null
  const height = num(raw.height)
  const fps = num(raw.fps)
  const vcodec = str(raw.vcodec)
  const acodec = str(raw.acodec)
  const hasVideo = isRealCodec(raw.vcodec)
  const hasAudio = isRealCodec(raw.acodec)
  const abr = num(raw.abr)
  const tbr = num(raw.tbr)
  const filesize = num(raw.filesize) ?? num(raw.filesize_approx)
  const quality = str(raw.quality)
  const protocol = str(raw.protocol)
  let label = ''
  if (hasVideo && height) {
    label = String(height) + 'p'
    if (fps && fps >= 50) label += '60'
    label += ' ' + ext
    if (!hasAudio) label += ' (video only)'
  } else if (!hasVideo && abr) {
    label = Math.round(abr) + ' kbps ' + ext
  } else if (!hasVideo) {
    label = 'audio ' + ext
  } else {
    label = 'video ' + ext
  }
  return {
    formatId,
    ext,
    label,
    kind: hasVideo && hasAudio ? 'muxed' : hasVideo ? 'video' : 'audio',
    height,
    fps,
    vcodec,
    acodec,
    abr,
    tbr,
    filesize,
    quality,
    note,
    protocol,
  }
}

export function formatScore(f: FormatInfo): number {
  let score = (f.height ?? 0) * 1000
  if (f.fps && f.fps >= 50) score += 200
  if (f.ext === 'mp4') score += 60
  if (f.vcodec && f.vcodec.indexOf('avc1') === 0) score += 120
  if (f.vcodec && f.vcodec.indexOf('vp9') === 0) score += 60
  score += Math.min(50, (f.tbr ?? 0) / 100)
  return score
}

export function audioScore(f: FormatInfo): number {
  let score = f.abr ?? f.tbr ?? 0
  if (f.ext === 'm4a') score += 40
  if (f.acodec && f.acodec.indexOf('mp4a') === 0) score += 30
  if (f.ext === 'webm') score += 10
  return score
}

/** Formats a <video>/<audio> element can read straight off the proxy: one plain HTTPS file. */
export function playable(f: FormatInfo): boolean {
  if (f.formatId === '' || f.ext === 'm3u8' || f.ext === 'mpd' || f.ext === 'mhtml') return false
  return !f.protocol || f.protocol === 'https' || f.protocol === 'http'
}

export function pickBestVideo(formats: FormatInfo[], height: number | null): FormatInfo | null {
  const candidates = formats.filter(function (f) { return f.kind !== 'audio' && playable(f) }).filter(function (f) {
    return !height || height <= 0 || (f.height ?? 0) <= height
  })
  if (!candidates.length) return null
  return candidates.slice().sort(function (a, b) { return formatScore(b) - formatScore(a) })[0]
}

export function pickBestAudio(formats: FormatInfo[]): FormatInfo | null {
  const candidates = formats.filter(function (f) { return f.kind === 'audio' && playable(f) })
  if (!candidates.length) return null
  return candidates.slice().sort(function (a, b) { return audioScore(b) - audioScore(a) })[0]
}

export function pickMuxed(formats: FormatInfo[], height: number | null): FormatInfo | null {
  const candidates = formats.filter(function (f) { return f.kind === 'muxed' && playable(f) }).filter(function (f) {
    return !height || height <= 0 || (f.height ?? 0) <= height
  })
  if (!candidates.length) return null
  return candidates.slice().sort(function (a, b) { return formatScore(b) - formatScore(a) })[0]
}

function mapFormats(info: Record<string, unknown>): FormatInfo[] {
  const raw = Array.isArray(info.formats) ? (info.formats as Record<string, unknown>[]) : []
  const out: FormatInfo[] = []
  raw.forEach(function (f) {
    const mapped = toFormatInfo(f)
    if (mapped) out.push(mapped)
  })
  return out
}

/**
 * Format selector for the two download modes.
 * With ffmpeg, video and audio are fetched separately (that is the only way to get 1080p and up)
 * and merged. Without it, only formats YouTube serves as one file can be used.
 */
export function buildFormatSelector(mode: 'video_audio' | 'audio_only', height: number | null, canMerge: boolean, codec: VideoCodec = 'compatible'): string {
  if (mode === 'audio_only') return canMerge ? 'bestaudio/best' : 'bestaudio[ext=m4a]/bestaudio/best'
  const limit = height && height > 0 ? '[height<=' + height + ']' : ''
  if (!canMerge) return 'best' + limit + '[vcodec!=none][acodec!=none]/best' + limit + '/best'
  // Highest quality whatever the codec (VP9/AV1 are often sharper at the same size).
  if (codec === 'best') return 'bestvideo' + limit + '+bestaudio/best' + limit + '/best'
  // H.264 first: it plays in every player. AV1/VP9 only when nothing else exists at that size.
  return (
    'bestvideo' + limit + '[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo' + limit + '[ext=mp4]+bestaudio[ext=m4a]/bestvideo' +
    limit + '+bestaudio/best' + limit + '/best'
  )
}

export async function probe(url: string): Promise<VideoMeta> {
  const args = [...baseArgs(), '--no-progress', '--no-warnings', '-J', '--flat-playlist', '--playlist-end', '2000', '--', url]
  const info = await runJson(args, 90000)
  const type = str(info._type)
  if (type === 'playlist' || type === 'multi_video') {
    const rawEntries = Array.isArray(info.entries) ? (info.entries as Record<string, unknown>[]) : []
    const entries: PlaylistEntry[] = rawEntries.filter(Boolean).map(function (e) {
      const id = str(e.id) ?? ''
      let entryUrl = str(e.webpage_url) ?? str(e.url) ?? ''
      if (entryUrl && entryUrl.indexOf('http') !== 0) entryUrl = 'https://www.youtube.com/watch?v=' + entryUrl
      return {
        id: id,
        title: str(e.title) ?? id,
        url: entryUrl,
        duration: num(e.duration),
        thumbnail: thumbOf(e),
        uploader: str(e.uploader) ?? str(e.channel),
      }
    })
    return {
      id: str(info.id) ?? '',
      url,
      title: str(info.title) ?? 'Playlist',
      uploader: str(info.uploader) ?? str(info.channel),
      duration: null,
      thumbnail: thumbOf(info) ?? (entries[0] ? entries[0].thumbnail : null),
      description: null,
      viewCount: null,
      uploadDate: null,
      isLive: false,
      isPlaylist: true,
      playlistTitle: str(info.title),
      entryCount: rawEntries.length,
      entries,
      formats: [],
      heights: [],
      subtitles: [],
      extractor: str(info.extractor_key) ?? str(info.extractor),
    }
  }
  const formats = mapFormats(info)
  const heights = Array.from(
    new Set(
      formats
        .filter(function (f) { return f.kind !== 'audio' && f.height })
        .map(function (f) { return f.height as number }),
    ),
  ).sort(function (a, b) { return b - a })
  const subs = info.subtitles && typeof info.subtitles === 'object' ? Object.keys(info.subtitles as Record<string, unknown>) : []
  return {
    id: str(info.id) ?? '',
    url,
    title: str(info.title) ?? 'Untitled',
    uploader: str(info.uploader) ?? str(info.channel),
    duration: num(info.duration),
    thumbnail: thumbOf(info),
    description: str(info.description),
    viewCount: num(info.view_count),
    uploadDate: str(info.upload_date),
    isLive: info.is_live === true,
    isPlaylist: false,
    playlistTitle: null,
    entryCount: 1,
    entries: [],
    formats,
    heights,
    subtitles: subs,
    extractor: str(info.extractor_key) ?? str(info.extractor),
  }
}

function thumbOf(info: Record<string, unknown>): string | null {
  const direct = str(info.thumbnail)
  if (direct) return direct
  const thumbs = Array.isArray(info.thumbnails) ? (info.thumbnails as Record<string, unknown>[]) : []
  const usable = thumbs.filter(function (t) { return str(t.url) })
  if (!usable.length) return null
  const last = usable[usable.length - 1]
  return str(last.url)
}

export interface Upstream {
  url: string
  /** Headers yt-dlp says this URL must be fetched with (User-Agent etc. of the client that produced it). */
  headers: Record<string, string>
}

function toUpstream(raw: Record<string, unknown>): Upstream | null {
  const url = str(raw.url)
  if (!url) return null
  const headers: Record<string, string> = {}
  const given = raw.http_headers && typeof raw.http_headers === 'object' ? (raw.http_headers as Record<string, unknown>) : {}
  Object.keys(given).forEach(function (key) {
    const value = given[key]
    if (typeof value === 'string') headers[key] = value
  })
  return { url, headers }
}

/** Ask yt-dlp for the direct media URL(s) (and their required headers) for a selector, video first. */
export async function directUrls(pageUrl: string, selector: string): Promise<Upstream[]> {
  const args = [...baseArgs(), '--no-progress', '--no-warnings', '--no-playlist', '-f', selector, '-j', '--', pageUrl]
  const info = await runJson(args, 90000)
  const requested = Array.isArray(info.requested_formats) ? (info.requested_formats as Record<string, unknown>[]) : []
  const list = (requested.length ? requested : [info]).map(toUpstream).filter(function (u): u is Upstream { return !!u })
  if (!list.length) throw new Error('Could not resolve a playable stream URL')
  return list
}

export function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mov: 'video/quicktime',
    '3gp': 'video/3gpp',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    opus: 'audio/ogg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    aac: 'audio/aac',
  }
  return map[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** The full yt-dlp info JSON for one video (captions, chapters, description...). */
export async function infoJson(url: string): Promise<Record<string, unknown>> {
  const args = [...baseArgs(), '--no-progress', '--no-warnings', '--no-playlist', '--skip-download', '-J', '--', url]
  return runJson(args, 90000)
}

export interface SearchHit {
  id: string
  url: string
  title: string
  channel: string | null
  duration: number | null
  views: number | null
  description: string | null
  live: boolean
  short: boolean
}

/** Run a YouTube results page (search URL with filters) and return its videos, flat. */
export async function searchVideos(searchUrl: string, limit: number): Promise<SearchHit[]> {
  const args = [...baseArgs(), '--no-progress', '--no-warnings', '-J', '--flat-playlist', '--playlist-end', String(limit), '--', searchUrl]
  const info = await runJson(args, 75000)
  const raw = Array.isArray(info.entries) ? (info.entries as Record<string, unknown>[]) : []
  const out: SearchHit[] = []
  raw.filter(Boolean).forEach(function (e) {
    const id = str(e.id)
    const link = str(e.url) ?? ''
    // Flat search pages also list channels and playlists; keep only videos (11-character ids).
    if (!id || !/^[\w-]{11}$/.test(id)) return
    const liveStatus = str(e.live_status)
    if (liveStatus === 'is_upcoming') return
    out.push({
      id,
      url: 'https://www.youtube.com/watch?v=' + id,
      title: str(e.title) ?? id,
      channel: str(e.channel) ?? str(e.uploader),
      duration: num(e.duration),
      views: num(e.view_count),
      description: str(e.description),
      live: liveStatus === 'is_live',
      short: link.indexOf('/shorts/') >= 0,
    })
  })
  return out
}

/**
 * Download one caption track as WebVTT into dir and return its path (null when nothing was written).
 * auto: use YouTube's automatic captions instead of uploaded subtitles.
 */
export async function downloadCaptions(url: string, lang: string, auto: boolean, dir: string): Promise<string | null> {
  const args = [
    ...baseArgs(), '--no-progress', '--no-warnings', '--no-playlist', '--skip-download',
    auto ? '--write-auto-subs' : '--write-subs', '--sub-langs', lang, '--sub-format', 'vtt/best',
    '-P', dir, '-o', 'captions.%(ext)s', '--', url,
  ]
  const res = await runYtdlp(args, { timeoutMs: 90000 })
  if (!res.ok) log('captions: yt-dlp exited ' + res.code + ' ' + cleanError(res.stderr))
  const { readdirSync } = await import('node:fs')
  const file = readdirSync(dir).find(function (name) { return name.startsWith('captions.') && name.endsWith('.vtt') })
  return file ? join(dir, file) : null
}
