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
import { baseArgs, buildFormatSelector, cleanError, resolveYtdlp, ytdlpEnv } from './ytdlp'
import { safeFolderName } from './library-state'

const PROGRESS_PREFIX = '@@P '
const MAX_HISTORY = 300

/** yt-dlp log prefixes for post-processing steps, and what to tell the user while they run. */
const PROCESSING_STAGES: Array<[string, string]> = [
  ['[Merger]', 'Merging video and audio'],
  ['[ExtractAudio]', 'Converting audio'],
  ['[VideoConvertor]', 'Converting video'],
  ['[VideoRemuxer]', 'Remuxing video'],
  ['[Fixup', 'Fixing up the file'],
  ['[Metadata]', 'Writing metadata'],
  ['[EmbedThumbnail]', 'Embedding thumbnail'],
  ['[ThumbnailsConvertor]', 'Converting thumbnail'],
  ['[SubtitlesConvertor]', 'Converting subtitles'],
  ['[EmbedSubtitle]', 'Embedding subtitles'],
  ['[MoveFiles]', 'Moving file into place'],
]

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

/** "1:05" / "1:02:03" for clip labels. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = function (n: number) { return n < 10 ? '0' + n : String(n) }
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

/** yt-dlp --download-sections value for a clip, or null for the whole video. */
export function clipSection(start: number | null | undefined, end: number | null | undefined): string | null {
  const from = typeof start === 'number' && start > 0 ? start : null
  const to = typeof end === 'number' && end > 0 ? end : null
  if (from === null && to === null) return null
  if (from !== null && to !== null && to <= from) return null
  return '*' + (from !== null ? from : 0) + '-' + (to !== null ? to : 'inf')
}

function isActive(job: DownloadJob): boolean {
  return job.status === 'downloading' || job.status === 'processing'
}

function isPending(job: DownloadJob): boolean {
  return isActive(job) || job.status === 'queued'
}

export interface DownloadEvents {
  /** Any job changed (progress included); throttled by the caller if needed. */
  onChange?: (jobs: DownloadJob[]) => void
  /** A job completed or failed. */
  onFinish?: (job: DownloadJob) => void
}

class DownloadManager {
  private jobs = new Map<string, DownloadJob>()
  private requests = new Map<string, DownloadRequest>()
  private children = new Map<string, ChildProcess>()
  /** Why a running job was stopped, so its exit is not reported as a failure. */
  private stopping = new Map<string, 'cancel' | 'pause'>()
  private saveTimer: NodeJS.Timeout | null = null
  private events: DownloadEvents = {}

  init(): void {
    const stored = readJobsFile()
    stored.slice(0, MAX_HISTORY).forEach((job) => {
      if (job.status === 'downloading' || job.status === 'processing' || job.status === 'queued') {
        // yt-dlp continues from the partial file, so an interrupted download can simply be resumed.
        job.status = 'paused'
        job.stage = 'Paused when the app closed'
        job.speed = null
        job.eta = null
      }
      job.folder = job.folder ?? null
      job.playlistIndex = job.playlistIndex ?? null
      if (job.request) this.requests.set(job.id, job.request)
      this.jobs.set(job.id, job)
    })
    log('downloads: restored', this.jobs.size, 'history entries')
  }

  setEvents(events: DownloadEvents): void {
    this.events = events
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
      stage: 'Waiting in queue',
      folder: safeFolderName(req.folder),
      playlistIndex: req.folder && req.playlistIndex ? req.playlistIndex : null,
      logTail: '',
      createdAt: this.nextCreatedAt(),
      startedAt: null,
      finishedAt: null,
      request: req,
    }
    this.jobs.set(job.id, job)
    this.requests.set(job.id, req)
    this.persist()
    this.emit(job)
    this.pump()
    return job
  }

  private lastCreated = 0

  /** Strictly increasing, so a playlist queued in one go downloads in playlist order. */
  private nextCreatedAt(): number {
    this.lastCreated = Math.max(nowMs(), this.lastCreated + 1)
    return this.lastCreated
  }

  createMany(reqs: DownloadRequest[]): DownloadJob[] {
    return reqs.map((req) => this.create(req))
  }

  private describeQuality(req: DownloadRequest): string {
    const parts: string[] = []
    if (req.mode === 'audio_only') {
      parts.push(ffmpegLocation() ? (req.audioFormat ?? settings.get('audioFormat')) + ' audio' : 'audio')
    } else {
      const height = req.height ?? settings.get('preferredHeight')
      parts.push(height && height > 0 ? 'video + audio · up to ' + height + 'p' : 'video + audio · best')
    }
    if (clipSection(req.clipStart, req.clipEnd)) {
      parts.push('clip ' + clock(req.clipStart ?? 0) + '–' + (req.clipEnd ? clock(req.clipEnd) : 'end'))
    }
    if (req.sponsorBlock && ffmpegLocation()) parts.push('no sponsors')
    return parts.join(' · ')
  }

  /** Stop a download but keep its partial file, so Resume continues where it stopped. */
  pause(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued') {
      this.setPaused(job)
      return
    }
    if (job.status !== 'downloading') return
    if (!this.children.get(id)) {
      this.setPaused(job)
      return
    }
    this.stop(job, 'pause')
  }

  resume(id: string): void {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'paused') return
    job.status = 'queued'
    job.stage = 'Waiting in queue'
    job.error = null
    this.persist()
    this.emit(job)
    this.pump()
  }

  /** Put a waiting job at the front of the queue. */
  prioritize(id: string): void {
    const job = this.jobs.get(id)
    if (!job || (job.status !== 'queued' && job.status !== 'paused')) return
    const waiting = Array.from(this.jobs.values()).filter(function (j) { return j.status === 'queued' })
    const first = waiting.reduce(function (min, j) { return Math.min(min, j.createdAt) }, job.createdAt)
    job.createdAt = first - 1
    if (job.status === 'paused') {
      job.status = 'queued'
      job.stage = 'Waiting in queue'
    }
    this.persist()
    this.emit(job)
    this.pump()
  }

  pauseAll(): number {
    const targets = Array.from(this.jobs.values()).filter(function (j) { return j.status === 'queued' || j.status === 'downloading' })
    // Queued ones first, so stopping a running one does not start the next.
    targets.sort(function (a, b) { return (a.status === 'queued' ? 0 : 1) - (b.status === 'queued' ? 0 : 1) })
    targets.forEach((job) => this.pause(job.id))
    return targets.length
  }

  resumeAll(): number {
    const paused = Array.from(this.jobs.values())
      .filter(function (j) { return j.status === 'paused' })
      .sort(function (a, b) { return a.createdAt - b.createdAt })
    paused.forEach((job) => {
      job.status = 'queued'
      job.stage = 'Waiting in queue'
      job.error = null
      this.emit(job)
    })
    this.persist()
    this.pump()
    return paused.length
  }

  retryFailed(): number {
    const failed = Array.from(this.jobs.values()).filter(function (j) { return j.status === 'error' })
    failed.sort(function (a, b) { return a.createdAt - b.createdAt }).forEach((job) => this.retry(job.id))
    return failed.length
  }

  private setPaused(job: DownloadJob): void {
    job.status = 'paused'
    job.stage = 'Paused'
    job.speed = null
    job.eta = null
    this.persist()
    this.emit(job)
  }

  cancel(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.status === 'queued' || job.status === 'paused') {
      this.finish(job, 'canceled', { error: job.status === 'paused' ? 'Canceled' : 'Canceled before it started' })
      return
    }
    const child = this.children.get(id)
    if (!child || child.pid === undefined) {
      this.finish(job, 'canceled', { error: 'Canceled' })
      return
    }
    this.stop(job, 'cancel')
  }

  /** Kill the running yt-dlp (and its ffmpeg children); the exit handler finishes the job. */
  private stop(job: DownloadJob, reason: 'cancel' | 'pause'): void {
    const child = this.children.get(job.id)
    if (!child || child.pid === undefined) return
    this.stopping.set(job.id, reason)
    job.stage = reason === 'pause' ? 'Pausing…' : 'Stopping…'
    this.emit(job)
    job.logTail = (job.logTail + '\n[' + reason + '] stopping\n').slice(-4000)
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
    if (isActive(job)) return job
    job.status = 'queued'
    job.percent = 0
    job.speed = null
    job.eta = null
    job.downloadedBytes = 0
    job.totalBytes = 0
    job.error = null
    job.stage = 'Waiting in queue'
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
    this.requests.delete(id)
    this.persist()
    this.emit(job, true)
  }

  clearFinished(): void {
    const removable: string[] = []
    this.jobs.forEach(function (job, id) {
      if (job.status === 'completed' || job.status === 'error' || job.status === 'canceled') removable.push(id)
    })
    removable.forEach((id) => {
      const job = this.jobs.get(id)
      this.jobs.delete(id)
      this.requests.delete(id)
      if (job) this.emit(job, true)
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
    job.stage = 'Contacting YouTube'
    this.emit(job)
    log('downloads.start', job.id, job.title)
    log('downloads.args', args.join(' '))
    let child: ChildProcess
    try {
      child = spawn(bin.path, args, { windowsHide: true, env: ytdlpEnv() })
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
    let streams = 0
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
      const processing = PROCESSING_STAGES.find(function (pair) { return trimmed.indexOf(pair[0]) === 0 })
      if (processing) {
        const changed = job.status !== 'processing' || job.stage !== processing[1]
        job.status = 'processing'
        job.stage = processing[1]
        job.percent = Math.max(job.percent, 99)
        job.speed = null
        job.eta = null
        if (changed) this.emit(job)
        return
      }
      if (trimmed.indexOf('[download] Destination:') === 0) {
        streams += 1
        if (job.title === 'Pending...' || job.title === 'Queued link') job.title = cleanTitle(trimmed)
        // A merged download fetches the silent video first, then the audio track; each runs 0-100%.
        if (job.mode === 'audio_only') job.stage = 'Downloading audio'
        else if (streams === 1) job.stage = 'Downloading video'
        else job.stage = 'Downloading audio track'
        job.percent = 0
        job.downloadedBytes = 0
        job.totalBytes = 0
        this.emit(job)
        return
      }
      let stage: string | null = null
      if (/^\[youtube[^\]]*\].*(Downloading|Extracting)/.test(trimmed)) stage = 'Fetching video info'
      else if (trimmed.indexOf('[info]') === 0 && trimmed.indexOf('Downloading') >= 0 && trimmed.indexOf('format') >= 0) stage = 'Starting download'
      else if (/^\[(hlsnative|dashsegments)\]/.test(trimmed)) stage = 'Downloading stream fragments'
      else if (trimmed.indexOf('has already been downloaded') >= 0) stage = 'Already downloaded'
      if (stage && stage !== job.stage && job.status === 'downloading') {
        job.stage = stage
        this.emit(job)
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
      this.stopping.delete(job.id)
      this.finish(job, 'error', { error: String(err) })
      this.pump()
    })
    child.on('close', (code) => {
      this.children.delete(job.id)
      const stopped = this.stopping.get(job.id)
      this.stopping.delete(job.id)
      if (stopped === 'pause') {
        this.setPaused(job)
        this.pump()
        return
      }
      if (stopped === 'cancel' || job.status === 'canceled') {
        if (job.status !== 'canceled') this.finish(job, 'canceled', { error: 'Canceled' })
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

  /** Playlist downloads go into their own folder, numbered so the folder lists in playlist order. */
  private outputTemplate(job: DownloadJob): string {
    const template = settings.get('filenameTemplate')
    if (!job.folder) return template
    const prefix = job.playlistIndex ? String(job.playlistIndex).padStart(3, '0') + ' - ' : ''
    return (job.folder + '/' + prefix).replace(/%/g, '%%') + template
  }

  /** Scratch file where yt-dlp reports the exact path it finished writing. */
  private pathFileFor(job: DownloadJob): string {
    return join(tmpdir(), 'ytd-studio-' + job.id + '.path')
  }

  private buildArgs(job: DownloadJob, dir: string): string[] {
    const original = this.requests.get(job.id) ?? job.request ?? undefined
    const mode = original?.mode ?? job.mode
    const height: number | null = original?.height ?? settings.get('preferredHeight')
    const audioFormat = original?.audioFormat ?? settings.get('audioFormat')
    const audioQuality = original?.audioQuality ?? settings.get('audioQuality')
    const ffmpeg = ffmpegLocation()
    const selector = buildFormatSelector(mode, height ?? null, !!ffmpeg, settings.get('videoCodec'))
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
      this.outputTemplate(job),
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
    const rate = settings.get('rateLimit')
    if (rate) args.push('--limit-rate', rate)
    if (ffmpeg) {
      const section = clipSection(original?.clipStart, original?.clipEnd)
      if (section) args.push('--download-sections', section)
      if (original?.sponsorBlock) args.push('--sponsorblock-remove', 'sponsor,selfpromo,interaction')
      // Tags, chapters and cover art inside the file, so other players show them too.
      // (With --write-thumbnail as well, the separate image is kept for the Library.)
      if (settings.get('embedMetadata')) {
        args.push('--embed-metadata', '--embed-chapters')
        if (mode === 'audio_only' ? audioFormat !== 'wav' : true) args.push('--embed-thumbnail')
      }
    }
    args.push('--', job.url)
    return args
  }

  /** Overall state for the taskbar: fraction done of what is running or waiting, or null when idle. */
  summary(): { active: number; fraction: number | null; paused: number } {
    const pending = Array.from(this.jobs.values()).filter(isPending)
    const paused = Array.from(this.jobs.values()).filter(function (j) { return j.status === 'paused' }).length
    if (!pending.length) return { active: 0, fraction: null, paused }
    const total = pending.reduce(function (sum, j) { return sum + (j.status === 'queued' ? 0 : j.percent) }, 0)
    return { active: pending.length, fraction: Math.max(0.01, Math.min(1, total / (pending.length * 100))), paused }
  }

  private finish(job: DownloadJob, status: JobStatus, extra: { error?: string | null; outputPath?: string | null }): void {
    job.status = status
    job.finishedAt = nowMs()
    if (extra.error !== undefined) job.error = extra.error
    if (extra.outputPath !== undefined) job.outputPath = extra.outputPath
    job.stage = status === 'completed' ? 'Saved' : status === 'canceled' ? 'Stopped' : status === 'error' ? 'Failed' : job.stage
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
    if (status === 'completed' || status === 'error') {
      try {
        this.events.onFinish?.(job)
      } catch (err) {
        logError('downloads.onFinish', err)
      }
    }
  }

  private emit(job: DownloadJob, removed = false): void {
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
    broadcast(IPC.jobsProgress, { job: payload, full: job, removed })
    if (this.events.onChange) {
      try {
        this.events.onChange(this.list())
      } catch (err) {
        logError('downloads.onChange', err)
      }
    }
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
