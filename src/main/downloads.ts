import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { DownloadJob, DownloadRequest, JobStatus, ProgressEvent } from '@shared/types'
import { IPC } from '@shared/ipc'
import { broadcast } from './bus'
import { log, logError } from './logger'
import { ensureDir, jobsFile } from './paths'
import { settings } from './settings'
import { imageProxyUrl } from './media-server'
import { ffmpegLocation } from './ffmpeg'
import { baseArgs, buildFormatSelector, cleanError, resolveYtdlp } from './ytdlp'

const PROGRESS_PREFIX = '@@P '
const MAX_HISTORY = 300

const MEDIA_EXT = ['.mp4', '.mkv', '.webm', '.mov', '.m4v', '.avi', '.flv', '.3gp', '.mp3', '.m4a', '.opus', '.ogg', '.oga', '.wav', '.flac', '.aac']

function nowMs(): number {
  return Date.now()
}

/** Pull a YouTube video id out of any common link shape. */
export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const segment = parsed.pathname.split('/').filter(Boolean)[0]
      return segment || null
    }
    if (host.endsWith('youtube.com')) {
      const fromQuery = parsed.searchParams.get('v')
      if (fromQuery) return fromQuery
      const parts = parsed.pathname.split('/').filter(Boolean)
      if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) return parts[1]
    }
    return null
  } catch {
    return null
  }
}

function readJobsFile(): DownloadJob[] {
  try {
    const file = jobsFile()
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? (parsed as DownloadJob[]) : []
  } catch (err) {
    logError('downloads.load', err)
    return []
  }
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
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      return
    }
    if (st.isDirectory()) {
      if (name.startsWith('.')) return
      walk(full, depth - 1, out)
      return
    }
    out.push(full)
  })
}

/** Last path yt-dlp reported through --print-to-file (the merged or converted result), then clean up. */
function readReportedPath(file: string): string | null {
  try {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).map(function (l) { return l.trim() }).filter(Boolean)
    const last = lines[lines.length - 1]
    return last && existsSync(last) ? last : null
  } catch {
    return null
  } finally {
    try {
      unlinkSync(file)
    } catch {
      /* nothing to clean */
    }
  }
}

/** Find the file yt-dlp produced for a given video id. */
export function findOutputFile(dir: string, videoId: string | null, since: number): string | null {
  const files: string[] = []
  walk(dir, 3, files)
  const media = files.filter(function (f) { return MEDIA_EXT.includes(extname(f).toLowerCase()) })
  if (videoId) {
    const tagged = media.filter(function (f) { return f.includes('[' + videoId + ']') })
    if (tagged.length) {
      return tagged.sort(function (a, b) { return statSync(b).mtimeMs - statSync(a).mtimeMs })[0]
    }
  }
  const recent = media.filter(function (f) {
    try {
      return statSync(f).mtimeMs >= since - 5000
    } catch {
      return false
    }
  })
  if (!recent.length) return null
  return recent.sort(function (a, b) { return statSync(b).mtimeMs - statSync(a).mtimeMs })[0]
}

export interface QueueRequest extends DownloadRequest {}

class DownloadManager {
  private jobs = new Map<string, DownloadJob>()
  private requests = new Map<string, DownloadRequest>()
  private children = new Map<string, ChildProcess>()
  private saveTimer: NodeJS.Timeout | null = null

  init(): void {
    const stored = readJobsFile()
    stored.slice(0, MAX_HISTORY).forEach((job) => {
      if (job.status === 'downloading' || job.status === 'processing' || job.status === 'queued') {
        job.status = 'error'
        job.error = 'Interrupted when the app closed'
        job.finishedAt = job.finishedAt ?? nowMs()
      }
      this.jobs.set(job.id, job)
    })
    log('downloads: restored', this.jobs.size, 'history entries')
  }

  list(): DownloadJob[] {
    return Array.from(this.jobs.values()).sort(function (a, b) { return b.createdAt - a.createdAt })
  }

  activeCount(): number {
    let count = 0
    this.jobs.forEach(function (job) {
      if (job.status === 'downloading' || job.status === 'processing') count += 1
    })
    return count
  }

  create(req: DownloadRequest): DownloadJob {
    const job: DownloadJob = {
      id: randomUUID(),
      url: req.url,
      videoId: req.videoId ?? extractVideoId(req.url),
      title: req.title ?? 'Pending...',
      uploader: req.uploader ?? null,
      thumbnail: imageProxyUrl(req.thumbnail ?? null),
      duration: req.duration ?? null,
      mode: req.mode,
      qualityLabel: this.describeQuality(req),
      status: 'queued',
      percent: 0,
      speed: null,
      eta: null,
      downloadedBytes: 0,
      totalBytes: 0,
      outputPath: null,
      error: null,
      logTail: '',
      createdAt: nowMs(),
      startedAt: null,
      finishedAt: null,
    }
    this.jobs.set(job.id, job)
    this.requests.set(job.id, req)
    this.persist()
    this.emit(job)
    this.pump()
    return job
  }

  createMany(reqs: DownloadRequest[]): DownloadJob[] {
    return reqs.map((req) => this.create(req))
  }

  private describeQuality(req: DownloadRequest): string {
    if (req.mode === 'audio_only') return ffmpegLocation() ? (req.audioFormat ?? settings.get('audioFormat')) + ' audio' : 'audio'
    const height = req.height ?? settings.get('preferredHeight')
    return height && height > 0 ? 'video + audio · up to ' + height + 'p' : 'video + audio · best'
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.finish(job, 'canceled', { error: 'Canceled before it started' })
      return
    }
    const child = this.children.get(id)
    if (!child || child.pid === undefined) {
      this.finish(job, 'canceled', { error: 'Canceled' })
      return
    }
    job.logTail = (job.logTail + '\n[cancel] stopping\n').slice(-4000)
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
        setTimeout(function () {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }, 4000)
      }
    } catch (err) {
      logError('downloads.cancel', err)
    }
  }

  retry(id: string): DownloadJob | null {
    const job = this.jobs.get(id)
    if (!job) return null
    if (job.status === 'downloading' || job.status === 'processing') return job
    job.status = 'queued'
    job.percent = 0
    job.speed = null
    job.eta = null
    job.downloadedBytes = 0
    job.totalBytes = 0
    job.error = null
    job.outputPath = null
    job.logTail = ''
    job.startedAt = null
    job.finishedAt = null
    this.persist()
    this.emit(job)
    this.pump()
    return job
  }

  remove(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'downloading' || job.status === 'processing') this.cancel(id)
    this.jobs.delete(id)
    this.persist()
    this.emit(job)
  }

  clearFinished(): void {
    const removable: string[] = []
    this.jobs.forEach(function (job, id) {
      if (job.status === 'completed' || job.status === 'error' || job.status === 'canceled') removable.push(id)
    })
    removable.forEach((id) => {
      const job = this.jobs.get(id)
      this.jobs.delete(id)
      if (job) this.emit(job)
    })
    this.persist()
  }

  private pump(): void {
    const limit = settings.get('concurrentDownloads')
    if (this.activeCount() >= limit) return
    const next = Array.from(this.jobs.values())
      .filter(function (job) { return job.status === 'queued' })
      .sort(function (a, b) { return a.createdAt - b.createdAt })[0]
    if (!next) return
    this.start(next)
  }

  private start(job: DownloadJob): void {
    const bin = resolveYtdlp()
    if (!bin.path) {
      this.finish(job, 'error', { error: 'yt-dlp is not installed. Open Settings and install it, then retry.' })
      this.pump()
      return
    }
    const dir = ensureDir(settings.get('downloadsDir'))
    const args = this.buildArgs(job, dir)
    args.splice(args.length - 2, 0, '--print-to-file', 'after_move:%(filepath)s', this.pathFileFor(job))
    job.status = 'downloading'
    job.startedAt = nowMs()
    this.emit(job)
    log('downloads.start', job.id, job.title)
    log('downloads.args', args.join(' '))
    let child: ChildProcess
    try {
      child = spawn(bin.path, args, { windowsHide: true })
    } catch (err) {
      logError('downloads.spawn', err)
      this.finish(job, 'error', { error: String(err) })
      this.pump()
      return
    }
    this.children.set(job.id, child)
    const pathFile = this.pathFileFor(job)
    let buffer = ''
    let lastEmit = 0
    const handleLine = (line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return
      if (trimmed.indexOf(PROGRESS_PREFIX) === 0) {
        const parts = trimmed.slice(PROGRESS_PREFIX.length).split(' ')
        const downloaded = parseFloat(parts[0])
        const totalExact = parseFloat(parts[1])
        const totalEstimate = parseFloat(parts[2])
        const speed = parseFloat(parts[3])
        const eta = parseFloat(parts[4])
        const total = !isNaN(totalExact) ? totalExact : !isNaN(totalEstimate) ? totalEstimate : 0
        job.downloadedBytes = isNaN(downloaded) ? job.downloadedBytes : downloaded
        job.totalBytes = total > 0 ? total : job.totalBytes
        const pct = job.totalBytes > 0 ? (job.downloadedBytes / job.totalBytes) * 100 : 0
        job.percent = Math.max(0, Math.min(99.4, pct))
        job.speed = !isNaN(speed) && speed > 0 ? formatBytes(speed) + '/s' : job.speed
        job.eta = !isNaN(eta) && eta > 0 ? formatDuration(eta) : job.eta
        const now = nowMs()
        if (now - lastEmit > 250) {
          lastEmit = now
          this.emit(job)
        }
        return
      }
      job.logTail = (job.logTail + trimmed + '\n').slice(-4000)
      if (
        trimmed.indexOf('[Merger]') >= 0 ||
        trimmed.indexOf('[ExtractAudio]') >= 0 ||
        trimmed.indexOf('[VideoConvertor]') >= 0 ||
        trimmed.indexOf('[Fixup') >= 0 ||
        trimmed.indexOf('[Metadata]') >= 0 ||
        trimmed.indexOf('[EmbedThumbnail]') >= 0 ||
        trimmed.indexOf('[SubtitlesConvertor]') >= 0
      ) {
        if (job.status !== 'processing') {
          job.status = 'processing'
          job.percent = Math.max(job.percent, 99)
          this.emit(job)
        }
      }
      if (trimmed.indexOf('[download] Destination:') === 0) {
        if (job.title === 'Pending...' || job.title === 'Queued link') job.title = cleanTitle(trimmed)
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(handleLine)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      job.logTail = (job.logTail + text).slice(-4000)
    })
    child.on('error', (err) => {
      logError('downloads.child', err)
      this.children.delete(job.id)
      this.finish(job, 'error', { error: String(err) })
      this.pump()
    })
    child.on('close', (code) => {
      this.children.delete(job.id)
      if (job.status === 'canceled') {
        this.pump()
        return
      }
      if (code === 0) {
        const output = readReportedPath(pathFile) ?? findOutputFile(dir, job.videoId, job.startedAt ?? job.createdAt)
        this.finish(job, 'completed', {
          outputPath: output,
          error: output ? null : 'Downloaded, but the output file could not be located.',
        })
      } else {
        let message = cleanError(job.logTail) || 'yt-dlp exited with code ' + code
        if (!ffmpegLocation() && job.mode === 'video_audio' && /format is not available/i.test(message)) {
          message = 'This video is only offered as separate video and audio streams, and joining them needs ffmpeg. Install ffmpeg (use the Install ffmpeg button), then retry.'
        }
        this.finish(job, 'error', { error: message })
      }
      this.pump()
    })
  }

  /** Scratch file where yt-dlp reports the exact path it finished writing. */
  private pathFileFor(job: DownloadJob): string {
    return join(tmpdir(), 'ytd-studio-' + job.id + '.path')
  }

  private buildArgs(job: DownloadJob, dir: string): string[] {
    const original = this.requests.get(job.id)
    const mode = original?.mode ?? job.mode
    const height: number | null = original?.height ?? settings.get('preferredHeight')
    const audioFormat = original?.audioFormat ?? settings.get('audioFormat')
    const audioQuality = original?.audioQuality ?? settings.get('audioQuality')
    const ffmpeg = ffmpegLocation()
    const selector = buildFormatSelector(mode, height ?? null, !!ffmpeg)
    const args = [
      ...baseArgs(),
      '--newline',
      '--progress',
      '--progress-template',
      'download:' + PROGRESS_PREFIX + '%(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
      '--concurrent-fragments',
      '4',
      '--retries',
      '10',
      '--fragment-retries',
      '10',
      '--no-playlist',
      '--no-overwrites',
      '-P',
      dir,
      '-o',
      settings.get('filenameTemplate'),
      '-f',
      selector,
    ]
    if (ffmpeg) {
      args.push('--ffmpeg-location', ffmpeg)
      if (mode === 'audio_only') args.push('-x', '--audio-format', audioFormat, '--audio-quality', audioQuality)
      else args.push('--merge-output-format', 'mp4')
    }
    if (original?.writeThumbnails ?? settings.get('writeThumbnails')) {
      args.push('--write-thumbnail')
      if (ffmpeg) args.push('--convert-thumbnails', 'jpg')
    }
    if (original?.writeMetadata ?? settings.get('writeMetadata')) {
      args.push('--write-info-json')
    }
    if (original?.writeSubtitles ?? settings.get('writeSubtitles')) {
      const langs = (original?.subtitleLanguages ?? settings.get('subtitleLanguages')) || 'en'
      args.push('--write-subs', '--write-auto-subs', '--sub-langs', langs)
      if (ffmpeg) args.push('--convert-subs', 'srt')
    }
    args.push('--', job.url)
    return args
  }

  private finish(job: DownloadJob, status: JobStatus, extra: { error?: string | null; outputPath?: string | null }): void {
    job.status = status
    job.finishedAt = nowMs()
    if (extra.error !== undefined) job.error = extra.error
    if (extra.outputPath !== undefined) job.outputPath = extra.outputPath
    if (status === 'completed') {
      job.percent = 100
      job.speed = null
      job.eta = null
      if (job.outputPath && (job.title === 'Pending...' || job.title === 'Queued link')) {
        job.title = cleanTitle(job.outputPath)
      }
    }
    this.persist()
    this.emit(job)
    log('downloads.finish', job.id, status, job.outputPath ?? '')
  }

  private emit(job: DownloadJob): void {
    const payload: ProgressEvent = {
      id: job.id,
      status: job.status,
      percent: job.percent,
      speed: job.speed,
      eta: job.eta,
      downloadedBytes: job.downloadedBytes,
      totalBytes: job.totalBytes,
      outputPath: job.outputPath,
      error: job.error,
      title: job.title,
    }
    broadcast(IPC.jobsProgress, { job: payload, full: job })
  }

  private persist(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        const all = Array.from(this.jobs.values())
          .sort(function (a, b) { return b.createdAt - a.createdAt })
          .slice(0, MAX_HISTORY)
        writeFileSync(jobsFile(), JSON.stringify(all, null, 0), 'utf8')
      } catch (err) {
        logError('downloads.persist', err)
      }
    }, 800)
  }
}

function deriveTitle(line: string): string {
  const rest = line.replace('[download] Destination:', '').trim()
  const base = rest.split(/[/\\]/).pop() ?? rest
  return base.replace(/\.[a-z0-9]{2,4}$/i, '')
}

/** Friendly title from a filename, with the trailing [videoId] removed. */
function cleanTitle(line: string): string {
  const raw = deriveTitle(line)
  const stripped = raw.replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, '').trim()
  return stripped || raw
}

export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return (value >= 10 || unit === 0 ? Math.round(value).toString() : value.toFixed(1)) + ' ' + units[unit]
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = function (n: number) { return n < 10 ? '0' + n : String(n) }
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

export const downloads = new DownloadManager()

export type { DownloadManager }
