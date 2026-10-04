import type { FormatInfo, PlaylistEntry, StreamRequest, VideoMeta } from '@shared/types'
import { log } from './logger'
import { directUrls, mimeForExt, pickBestAudio, pickBestVideo, pickMuxed, playable, probe, type Upstream } from './ytdlp'

export interface ResolvedStream {
  meta: VideoMeta
  pageUrl: string
  videoId: string
  selector: string
  height: number | null
  heightOptions: number[]
  isAudioOnly: boolean
  separateAudio: boolean
  formatLabel: string
  videoUpstream: Upstream | null
  audioUpstream: Upstream | null
  videoExt: string
  audioExt: string
}

const probeCache = new Map<string, { meta: VideoMeta; at: number }>()
const PROBE_TTL = 5 * 60 * 1000

export async function probeCached(url: string): Promise<VideoMeta> {
  const hit = probeCache.get(url)
  if (hit && Date.now() - hit.at < PROBE_TTL) return hit.meta
  const meta = await probe(url)
  probeCache.set(url, { meta, at: Date.now() })
  return meta
}

/** Public metadata for a URL (playlists included). */
export async function describe(url: string): Promise<VideoMeta> {
  return probeCached(url)
}

export function clearProbeCache(): void {
  probeCache.clear()
}

function streamableHeights(formats: FormatInfo[]): number[] {
  const heights = formats
    .filter(function (f) { return f.kind !== 'audio' && !!f.height && playable(f) })
    .map(function (f) { return f.height as number })
  return Array.from(new Set(heights)).sort(function (a, b) { return b - a })
}

function requireSingle(meta: VideoMeta): void {
  if (meta.isPlaylist) {
    throw new Error('That link is a playlist (' + meta.entryCount + ' videos). Open a single video to stream, or use the Download tab to grab the whole playlist.')
  }
  if (!meta.formats.length) throw new Error('No playable formats were reported for this video.')
}

function liveOnly(meta: VideoMeta): boolean {
  return meta.isLive && meta.formats.filter(playable).length === 0
}

export async function resolveStream(req: StreamRequest): Promise<ResolvedStream> {
  const meta = await probeCached(req.url)
  requireSingle(meta)
  if (liveOnly(meta)) {
    throw new Error('This looks like an active live stream. In-app streaming is not supported for live video, but you can download it from the Download tab.')
  }
  const formats = meta.formats
  const heightOptions = streamableHeights(formats)

  let selectedVideo: FormatInfo | null = null
  if (req.formatId) {
    selectedVideo = formats.find(function (f) { return f.formatId === req.formatId }) ?? null
  }

  const audioOnly = !!req.audioOnly || (selectedVideo !== null && selectedVideo.kind === 'audio')

  if (audioOnly) {
    const audio = selectedVideo && selectedVideo.kind === 'audio' ? selectedVideo : pickBestAudio(formats)
    if (!audio) throw new Error('No audio-only format is available for this video.')
    const urls = await directUrls(req.url, audio.formatId)
    return {
      meta,
      pageUrl: req.url,
      videoId: meta.id,
      selector: audio.formatId,
      height: null,
      heightOptions,
      isAudioOnly: true,
      separateAudio: false,
      formatLabel: audio.label,
      videoUpstream: null,
      audioUpstream: urls[0],
      videoExt: '',
      audioExt: audio.ext,
    }
  }

  let video = selectedVideo && selectedVideo.kind !== 'audio' ? selectedVideo : pickBestVideo(formats, req.height ?? null)
  if (!video) video = pickMuxed(formats, req.height ?? null)
  if (!video) throw new Error('No in-app playable video format was found for this video.')

  if (video.kind === 'muxed') {
    const urls = await directUrls(req.url, video.formatId)
    if (urls.length >= 2) {
      return {
        meta,
        pageUrl: req.url,
        videoId: meta.id,
        selector: video.formatId,
        height: video.height,
        heightOptions,
        isAudioOnly: false,
        separateAudio: true,
        formatLabel: video.label,
        videoUpstream: urls[0],
        audioUpstream: urls[1],
        videoExt: video.ext,
        audioExt: video.ext,
      }
    }
    return {
      meta,
      pageUrl: req.url,
      videoId: meta.id,
      selector: video.formatId,
      height: video.height,
      heightOptions,
      isAudioOnly: false,
      separateAudio: false,
      formatLabel: video.label,
      videoUpstream: urls[0],
      audioUpstream: null,
      videoExt: video.ext,
      audioExt: '',
    }
  }

  const audio = pickBestAudio(formats)
  const selector = audio ? video.formatId + '+' + audio.formatId : video.formatId
  const urls = await directUrls(req.url, selector)
  const separateAudio = !!audio && urls.length >= 2
  return {
    meta,
    pageUrl: req.url,
    videoId: meta.id,
    selector,
    height: video.height,
    heightOptions,
    isAudioOnly: false,
    separateAudio,
    formatLabel: separateAudio ? video.label + ' + ' + (audio as FormatInfo).label : video.label,
    videoUpstream: urls[0],
    audioUpstream: separateAudio ? urls[1] : null,
    videoExt: video.ext,
    audioExt: separateAudio ? (audio as FormatInfo).ext : '',
  }
}

/** Re-resolve expired googlevideo URLs for an existing selection. */
export async function refreshUrls(pageUrl: string, selector: string): Promise<Upstream[]> {
  log('stream.refresh', pageUrl, selector)
  return directUrls(pageUrl, selector)
}

/** Pick a format id for the first usable video entry of a playlist. */
export function firstPlayableEntry(meta: VideoMeta): PlaylistEntry | null {
  return meta.entries.length ? meta.entries[0] : null
}

export { mimeForExt }
