import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { ClipRequest, SavedFile, SnapshotRequest } from '@shared/types'
import { ffmpegLocation } from './ffmpeg'
import { safeFolderName } from './library-state'
import { log } from './logger'
import { settings } from './settings'

/**
 * Cut a part of a downloaded file into a shareable clip (MP4, GIF or MP3), or grab one frame as a PNG.
 * Everything runs through the local ffmpeg; results land in "Clips" and "Snapshots" in the downloads folder.
 */

const GIF_MAX_SECONDS = 30
const CLIP_MAX_SECONDS = 30 * 60

function insideDownloads(absPath: string): string {
  const root = resolve(settings.get('downloadsDir'))
  const target = resolve(absPath)
  if (!target.startsWith(root + sep) || !existsSync(target)) throw new Error('That file is not in your downloads folder.')
  return target
}

function requireFfmpeg(): string {
  const ffmpeg = ffmpegLocation()
  if (!ffmpeg) throw new Error('This needs ffmpeg. Install it from the banner or Settings > Tools.')
  return ffmpeg
}

function stamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return (h ? h + 'h' : '') + (h || m ? m + 'm' : '') + (s < 10 && (h || m) ? '0' : '') + s + 's'
}

/** A free file name in the downloads folder's subfolder: "Title (1m02s-1m30s).mp4", "... (2).mp4"... */
function target(folder: string, title: string, suffix: string, ext: string): string {
  const dir = join(resolve(settings.get('downloadsDir')), folder)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const name = (safeFolderName(title) ?? 'clip').slice(0, 70)
  let candidate = join(dir, name + ' (' + suffix + ').' + ext)
  for (let n = 2; existsSync(candidate); n += 1) candidate = join(dir, name + ' (' + suffix + ') ' + n + '.' + ext)
  return candidate
}

/**
 * Run ffmpeg into out, through a hidden ".part" file (the Library ignores those) that is renamed when
 * ffmpeg is done, so a half-written clip never shows up anywhere.
 */
async function write(ffmpeg: string, args: string[], format: string, out: string, timeoutMs: number): Promise<void> {
  const part = out + '.part'
  try {
    await run(ffmpeg, [...args, '-f', format, part], timeoutMs)
    renameSync(part, out)
  } finally {
    if (existsSync(part)) rmSync(part, { force: true })
  }
}

function run(ffmpeg: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise<void>((resolveRun, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true })
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveRun()
      else reject(new Error('ffmpeg could not make it: ' + (stderr.trim().split(/\r?\n/).slice(-2).join(' ') || 'exit code ' + code)))
    })
  })
}

function saved(path: string): SavedFile {
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    size = 0
  }
  if (!size) throw new Error('ffmpeg finished but wrote nothing.')
  return { path, size }
}

export async function exportClip(req: ClipRequest): Promise<SavedFile> {
  const input = insideDownloads(req.absPath)
  const ffmpeg = requireFfmpeg()
  const start = Math.max(0, Number(req.start) || 0)
  const end = Number(req.end) || 0
  const length = end - start
  if (!(length >= 0.5)) throw new Error('Pick a part that is at least half a second long.')
  if (length > CLIP_MAX_SECONDS) throw new Error('Clips can be up to 30 minutes long.')
  if (req.format === 'gif' && length > GIF_MAX_SECONDS) throw new Error('GIFs can be up to ' + GIF_MAX_SECONDS + ' seconds long; pick a shorter part.')
  const suffix = stamp(start) + '-' + stamp(end)
  const title = req.title || 'Clip'
  const seek = ['-ss', start.toFixed(3), '-i', input, '-t', length.toFixed(3)]
  let out: string
  if (req.format === 'gif') {
    out = target('Clips', title, suffix, 'gif')
    const filter = 'fps=12,scale=480:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4'
    await write(ffmpeg, [...seek, '-vf', filter, '-loop', '0'], 'gif', out, 5 * 60 * 1000)
  } else if (req.format === 'mp3') {
    out = target('Clips', title, suffix, 'mp3')
    await write(ffmpeg, [...seek, '-vn', '-c:a', 'libmp3lame', '-q:a', '2'], 'mp3', out, 10 * 60 * 1000)
  } else {
    out = target('Clips', title, suffix, 'mp4')
    // Re-encoded so the cut is exact (a copy can only cut at keyframes).
    await write(ffmpeg, [...seek, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'], 'mp4', out, 20 * 60 * 1000)
  }
  log('clips: saved', out)
  return saved(out)
}

export async function snapshot(req: SnapshotRequest): Promise<SavedFile> {
  const input = insideDownloads(req.absPath)
  const ffmpeg = requireFfmpeg()
  const at = Math.max(0, Number(req.at) || 0)
  const out = target('Snapshots', req.title || 'Snapshot', stamp(at), 'png')
  await write(ffmpeg, ['-ss', at.toFixed(3), '-i', input, '-frames:v', '1', '-an', '-c:v', 'png', '-update', '1'], 'image2', out, 60 * 1000)
  log('clips: snapshot', out)
  return saved(out)
}
