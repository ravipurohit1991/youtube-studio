import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve as resolvePath, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { StreamSession, StreamTrack } from '@shared/types'
import { log, logError } from './logger'
import { settings } from './settings'
import { mimeForExt } from './ytdlp'
import { refreshUrls, type ResolvedStream } from './stream'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const IMAGE_HOSTS = ['ytimg.com', 'ggpht.com', 'googleusercontent.com', 'youtube.com', 'google.com']

interface Entry {
  id: string
  resolved: ResolvedStream
  upstream: { v: string | null; a: string | null }
  createdAt: number
}

const entries = new Map<string, Entry>()
let server: Server | null = null
let listenPort = 0
const SESSION_TTL = 3 * 60 * 60 * 1000

function base64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function fromBase64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

export function getMediaPort(): number {
  return listenPort
}

export function mediaUrlForPath(absPath: string): string {
  return 'http://127.0.0.1:' + listenPort + '/f/' + base64url(absPath)
}

export function imageProxyUrl(remote: string | null): string | null {
  if (!remote) return null
  if (remote.indexOf('http') !== 0) return null
  return 'http://127.0.0.1:' + listenPort + '/img?u=' + encodeURIComponent(remote)
}

function allowedRoot(): string {
  return resolvePath(settings.get('downloadsDir'))
}

function isInside(root: string, candidate: string): boolean {
  const rel = candidate.slice(root.length)
  return candidate === root || (candidate.startsWith(root + sep) && !rel.includes('..'))
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const rawStart = match[1]
  const rawEnd = match[2]
  if (rawStart === '' && rawEnd === '') return null
  let start: number
  let end: number
  if (rawStart === '') {
    const suffix = parseInt(rawEnd, 10)
    if (isNaN(suffix) || suffix <= 0) return 'unsatisfiable'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = parseInt(rawStart, 10)
    end = rawEnd === '' ? size - 1 : Math.min(parseInt(rawEnd, 10), size - 1)
  }
  if (isNaN(start) || isNaN(end) || start > end || start >= size) return 'unsatisfiable'
  return { start, end }
}

function commonHeaders(extra: Record<string, string | number>): Record<string, string | number> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    ...extra,
  }
}

function serveFile(req: IncomingMessage, res: ServerResponse, absPath: string): void {
  let size = 0
  try {
    size = statSync(absPath).size
  } catch (err) {
    res.writeHead(404, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('not found')
    return
  }
  const mime = mimeForExt(extname(absPath).replace('.', ''))
  const range = parseRange(req.headers.range, size)
  if (range === 'unsatisfiable') {
    res.writeHead(416, commonHeaders({ 'Content-Range': 'bytes */' + size, 'Content-Type': 'text/plain' }))
    res.end()
    return
  }
  if (range) {
    res.writeHead(206, commonHeaders({
      'Content-Type': mime,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    const stream = createReadStream(absPath, { start: range.start, end: range.end })
    stream.on('error', function () { res.destroy() })
    stream.pipe(res)
    return
  }
  res.writeHead(200, commonHeaders({
    'Content-Type': mime,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }))
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  const stream = createReadStream(absPath)
  stream.on('error', function () { res.destroy() })
  stream.pipe(res)
}

async function proxyUpstream(req: IncomingMessage, res: ServerResponse, entry: Entry, track: 'v' | 'a'): Promise<void> {
  const current = track === 'v' ? entry.upstream.v : entry.upstream.a
  if (!current) {
    res.writeHead(404, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('track not available')
    return
  }
  const fallbackMime = track === 'v' ? mimeForExt(entry.resolved.videoExt) : mimeForExt(entry.resolved.audioExt)
  const attempt = async function (url: string): Promise<Response> {
    const headers: Record<string, string> = {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.youtube.com/',
      Origin: 'https://www.youtube.com',
    }
    if (req.headers.range) headers.Range = String(req.headers.range)
    return fetch(url, { headers, method: req.method === 'HEAD' ? 'HEAD' : 'GET', redirect: 'follow' })
  }

  let upstream: Response
  try {
    upstream = await attempt(current)
    if (upstream.status === 403 || upstream.status === 410 || upstream.status === 404) {
      log('stream.expired, refreshing', entry.id, track)
      const urls = await refreshUrls(entry.resolved.pageUrl, entry.resolved.selector)
      const freshVideo = urls[0]
      const freshAudio = urls.length > 1 ? urls[1] : null
      entry.upstream = { v: freshVideo ?? null, a: entry.resolved.separateAudio ? freshAudio : null }
      const retryUrl = track === 'v' ? entry.upstream.v : entry.upstream.a
      if (!retryUrl) throw new Error('stream refresh returned no URL')
      upstream = await attempt(retryUrl)
    }
  } catch (err) {
    logError('media.proxy', err)
    res.writeHead(502, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('upstream unavailable')
    return
  }

  if (!upstream.ok && upstream.status !== 206) {
    log('media.proxy upstream status', upstream.status)
    res.writeHead(502, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('upstream status ' + upstream.status)
    return
  }

  const headers: Record<string, string | number> = {
    'Content-Type': upstream.headers.get('content-type') ?? fallbackMime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['Content-Length'] = length
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers['Content-Range'] = contentRange
  res.writeHead(upstream.status, commonHeaders(headers))
  if (req.method === 'HEAD' || !upstream.body) {
    res.end()
    return
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res)
  } catch {
    res.destroy()
  }
}

async function handleImage(req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<void> {
  const target = query.get('u')
  if (!target) {
    res.writeHead(400, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('missing u')
    return
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    res.writeHead(400, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('bad url')
    return
  }
  const hostOk = IMAGE_HOSTS.some(function (h) { return parsed.hostname === h || parsed.hostname.endsWith('.' + h) })
  if (!hostOk || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
    res.writeHead(403, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('host not allowed')
    return
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8', Referer: 'https://www.youtube.com/' },
    })
    if (!upstream.ok || !upstream.body) throw new Error('status ' + upstream.status)
    res.writeHead(200, commonHeaders({
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=3600',
    }))
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res)
  } catch (err) {
    res.writeHead(404, commonHeaders({ 'Content-Type': 'text/plain' }))
    res.end('image unavailable')
  }
}

function prune(): void {
  const now = Date.now()
  entries.forEach(function (entry, id) {
    if (now - entry.createdAt > SESSION_TTL) entries.delete(id)
  })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const host = req.headers.host ?? '127.0.0.1'
  let url: URL
  try {
    url = new URL(req.url ?? '/', 'http://' + host)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, commonHeaders({}))
    res.end()
    return
  }
  const path = url.pathname
  if (path === '/health') {
    res.writeHead(200, commonHeaders({ 'Content-Type': 'application/json' }))
    res.end(JSON.stringify({ ok: true, port: listenPort, sessions: entries.size }))
    return
  }
  if (path === '/img') {
    await handleImage(req, res, url.searchParams)
    return
  }
  if (path.indexOf('/f/') === 0) {
    const encoded = decodeURIComponent(path.slice(3))
    let absPath = ''
    try {
      absPath = resolvePath(normalize(fromBase64url(encoded)))
    } catch {
      res.writeHead(400, commonHeaders({ 'Content-Type': 'text/plain' }))
      res.end('bad path')
      return
    }
    if (!isInside(allowedRoot(), absPath) || !existsSync(absPath)) {
      res.writeHead(403, commonHeaders({ 'Content-Type': 'text/plain' }))
      res.end('outside downloads folder')
      return
    }
    serveFile(req, res, absPath)
    return
  }
  if (path.indexOf('/s/') === 0) {
    const parts = path.split('/').filter(Boolean)
    const id = parts[1]
    const track = parts[2]
    const entry = id ? entries.get(id) : undefined
    if (!entry || (track !== 'v' && track !== 'a')) {
      res.writeHead(404, commonHeaders({ 'Content-Type': 'text/plain' }))
      res.end('unknown stream session')
      return
    }
    await proxyUpstream(req, res, entry, track)
    return
  }
  res.writeHead(404, commonHeaders({ 'Content-Type': 'text/plain' }))
  res.end('not found')
}

export async function startMediaServer(preferredPort: number): Promise<number> {
  if (server) return listenPort
  const attempt = function (port: number): Promise<number> {
    return new Promise<number>(function (resolve, reject) {
      const s = createServer(function (req, res) {
        handle(req, res).catch(function (err) {
          logError('media.handle', err)
          try {
            res.writeHead(500)
            res.end()
          } catch {
            /* ignore */
          }
        })
      })
      s.on('error', function (err) { reject(err) })
      s.listen(port, '127.0.0.1', function () {
        server = s
        const addr = s.address()
        listenPort = typeof addr === 'object' && addr ? addr.port : port
        log('media server listening on', listenPort)
        resolve(listenPort)
      })
    })
  }
  try {
    return await attempt(preferredPort)
  } catch (err) {
    log('preferred media port busy, falling back to a random port')
    return attempt(0)
  }
}

export function stopMediaServer(): void {
  entries.clear()
  if (server) {
    server.close()
    server = null
    listenPort = 0
  }
}

export function createStreamSession(resolved: ResolvedStream): StreamSession {
  prune()
  const id = randomUUID()
  entries.set(id, {
    id,
    resolved,
    upstream: { v: resolved.videoUpstream, a: resolved.audioUpstream },
    createdAt: Date.now(),
  })
  const video: StreamTrack | null = resolved.videoUpstream
    ? { url: 'http://127.0.0.1:' + listenPort + '/s/' + id + '/v', ext: resolved.videoExt, mime: mimeForExt(resolved.videoExt) }
    : null
  const audio: StreamTrack | null = resolved.audioUpstream
    ? { url: 'http://127.0.0.1:' + listenPort + '/s/' + id + '/a', ext: resolved.audioExt, mime: mimeForExt(resolved.audioExt) }
    : null
  return {
    sessionId: id,
    pageUrl: resolved.pageUrl,
    videoId: resolved.videoId,
    title: resolved.meta.title,
    uploader: resolved.meta.uploader,
    duration: resolved.meta.duration,
    thumbnailUrl: imageProxyUrl(resolved.meta.thumbnail),
    downloadThumbnail: resolved.meta.thumbnail,
    isAudioOnly: resolved.isAudioOnly,
    separateAudio: resolved.separateAudio,
    height: resolved.height,
    heightOptions: resolved.heightOptions,
    video,
    audio,
    formatLabel: resolved.formatLabel,
  }
}

export function dropStreamSession(id: string): void {
  entries.delete(id)
}

export function dropStreamSessionsFor(pageUrl: string): void {
  entries.forEach(function (entry, id) {
    if (entry.resolved.pageUrl === pageUrl) entries.delete(id)
  })
}

export function sessionCount(): number {
  return entries.size
}
