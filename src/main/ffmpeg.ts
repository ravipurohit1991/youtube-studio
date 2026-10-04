import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ToolStatus, UpdateStatus } from '@shared/types'
import { log } from './logger'
import { binDir, ensureDir } from './paths'
import { settings } from './settings'
import { exeName, findOnPath } from './ytdlp'

/** Where the user can download ffmpeg from by hand. */
export const FFMPEG_DOWNLOAD_URL = 'https://www.gyan.dev/ffmpeg/builds/#release-builds'

/**
 * ffmpeg is never shipped with the app (the builds are GPL). It is downloaded on first run from one of
 * these archives into the app data folder. Tried in order; each zip holds <root>/bin/ffmpeg.exe.
 */
const FFMPEG_ARCHIVES = [
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
  'https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip',
]

interface Resolved {
  path: string
  source: 'settings' | 'bundled' | 'path' | 'missing'
}

let cache: { resolved: Resolved; status: ToolStatus } | null = null

export function invalidateFfmpeg(): void {
  cache = null
}

function isFile(p: string): boolean {
  try {
    return !!p && existsSync(p) && statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Typical install spots. A freshly installed ffmpeg is often not on this process's PATH yet
 * (PATH is read once at launch), so look in the places installers use as well.
 */
function commonLocations(): string[] {
  const name = exeName('ffmpeg')
  if (process.platform !== 'win32') return []
  const home = homedir()
  const local = process.env['LOCALAPPDATA'] || join(home, 'AppData', 'Local')
  const programData = process.env['ProgramData'] || 'C:\\ProgramData'
  return [
    join(local, 'Microsoft', 'WinGet', 'Links', name),
    join(programData, 'chocolatey', 'bin', name),
    join(home, 'scoop', 'shims', name),
    join('C:\\ffmpeg', 'bin', name),
    join('C:\\Program Files', 'ffmpeg', 'bin', name),
  ]
}

export function resolveFfmpeg(): Resolved {
  const override = settings.get('ffmpegPath').trim()
  if (override && isFile(override)) return { path: override, source: 'settings' }
  const managed = join(binDir(), exeName('ffmpeg'))
  if (isFile(managed)) return { path: managed, source: 'bundled' }
  const onPath = findOnPath(exeName('ffmpeg'))
  if (onPath) return { path: onPath, source: 'path' }
  const known = commonLocations().find(isFile)
  if (known) return { path: known, source: 'path' }
  return { path: '', source: 'missing' }
}

function readVersion(path: string): string | null {
  try {
    const res = spawnSync(path, ['-version'], { encoding: 'utf8', timeout: 20000, windowsHide: true })
    if (res.error || res.status !== 0 || !res.stdout) return null
    const match = /ffmpeg version (\S+)/.exec(res.stdout)
    return match ? match[1] : 'unknown'
  } catch {
    return null
  }
}

export function ffmpegStatus(): ToolStatus {
  if (cache) return cache.status
  const resolved = resolveFfmpeg()
  if (!resolved.path) {
    const status: ToolStatus = {
      path: null,
      version: null,
      source: 'missing',
      ok: false,
      hint: 'ffmpeg is not installed (use "Install ffmpeg" to download it). Without it, video downloads are limited to the lower-quality files YouTube serves as one piece, and audio is saved as-is (no MP3 conversion).',
    }
    cache = { resolved, status }
    return status
  }
  const version = readVersion(resolved.path)
  const status: ToolStatus = {
    path: resolved.path,
    version,
    source: resolved.source,
    ok: !!version,
    hint: version ? null : 'ffmpeg was found but did not respond to -version.',
  }
  cache = { resolved, status }
  return status
}

export function ffmpegReady(): boolean {
  return ffmpegStatus().ok
}

/** Value for yt-dlp --ffmpeg-location, or null when ffmpeg is unavailable. */
export function ffmpegLocation(): string | null {
  const status = ffmpegStatus()
  return status.ok && status.path ? status.path : null
}

/** bsdtar ships with Windows 10+ and reads zip archives; a GNU tar earlier on PATH (e.g. Git's) does not. */
function tarExecutable(): string {
  const system = join(process.env['SystemRoot'] || 'C:\Windows', 'System32', 'tar.exe')
  return existsSync(system) ? system : 'tar'
}

function extractFromZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise<void>(function (resolve, reject) {
    const args = ['-xf', zipPath, '-C', destDir, '*/bin/ffmpeg.exe', '*/bin/ffprobe.exe', '*/LICENSE*']
    const child = spawn(tarExecutable(), args, { windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', function (chunk: Buffer) { stderr += chunk.toString('utf8') })
    child.on('error', reject)
    child.on('close', function (code) {
      if (code === 0) resolve()
      else reject(new Error('Could not unpack the ffmpeg archive: ' + (stderr.trim() || 'tar exited with ' + code)))
    })
  })
}

async function downloadTo(url: string, target: string, onProgress: (s: UpdateStatus) => void): Promise<void> {
  const response = await fetch(url, { headers: { 'User-Agent': 'YTD-Studio' } })
  if (!response.ok || !response.body) throw new Error('Download failed with ' + response.status)
  const total = Number(response.headers.get('content-length')) || 0
  let received = 0
  let lastReport = 0
  const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  body.on('data', function (chunk: Buffer) {
    received += chunk.length
    const now = Date.now()
    if (now - lastReport < 400) return
    lastReport = now
    const done = (received / 1048576).toFixed(0)
    onProgress({
      phase: 'downloading',
      percent: total ? Math.min(99, Math.round((received / total) * 100)) : 0,
      message: 'Downloading ffmpeg... ' + done + (total ? ' / ' + (total / 1048576).toFixed(0) : '') + ' MB',
    })
  })
  await pipeline(body, createWriteStream(target))
}

let installing: Promise<ToolStatus> | null = null

/** Download ffmpeg + ffprobe into the app data folder. Concurrent callers share one install. */
export function installFfmpeg(onProgress: (s: UpdateStatus) => void): Promise<ToolStatus> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Automatic ffmpeg install is only available on Windows. Install ffmpeg with your package manager.'))
  }
  if (!installing) {
    installing = doInstall(function (update) { onProgress({ ...update, tool: 'ffmpeg' }) }).finally(function () { installing = null })
  }
  return installing
}

async function doInstall(onProgress: (s: UpdateStatus) => void): Promise<ToolStatus> {
  const dir = ensureDir(binDir())
  const work = join(dir, 'ffmpeg-install')
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  const zip = join(work, 'ffmpeg.zip')
  try {
    onProgress({ phase: 'checking', percent: 0, message: 'Preparing ffmpeg download...' })
    let lastError: unknown = null
    let downloaded = false
    for (const url of FFMPEG_ARCHIVES) {
      try {
        log('downloading ffmpeg from', url)
        await downloadTo(url, zip, onProgress)
        downloaded = true
        break
      } catch (err) {
        lastError = err
        log('ffmpeg download failed from', url, String(err))
      }
    }
    if (!downloaded) {
      throw new Error('Could not download ffmpeg (' + (lastError instanceof Error ? lastError.message : String(lastError)) + '). Check your connection and try again.')
    }
    onProgress({ phase: 'downloading', percent: 99, message: 'Unpacking ffmpeg...' })
    await extractFromZip(zip, work)
    const rootName = readdirSync(work).find(function (name) { return name !== basename(zip) })
    const root = join(work, rootName ?? '')
    const pairs: [string, string][] = [
      [join(root, 'bin', 'ffmpeg.exe'), join(dir, 'ffmpeg.exe')],
      [join(root, 'bin', 'ffprobe.exe'), join(dir, 'ffprobe.exe')],
    ]
    pairs.forEach(function (pair) {
      if (!isFile(pair[0])) throw new Error('The ffmpeg archive did not contain ' + basename(pair[0]))
    })
    pairs.forEach(function (pair) {
      rmSync(pair[1], { force: true })
      renameSync(pair[0], pair[1])
    })
    const license = readdirSync(root).find(function (name) { return /^license/i.test(name) })
    if (license) {
      rmSync(join(dir, 'ffmpeg-LICENSE.txt'), { force: true })
      renameSync(join(root, license), join(dir, 'ffmpeg-LICENSE.txt'))
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  invalidateFfmpeg()
  const status = ffmpegStatus()
  if (!status.ok) throw new Error('ffmpeg was downloaded but did not start. ' + (status.hint ?? ''))
  onProgress({ phase: 'done', percent: 100, message: 'ffmpeg ' + (status.version ?? '') + ' installed.' })
  return status
}
