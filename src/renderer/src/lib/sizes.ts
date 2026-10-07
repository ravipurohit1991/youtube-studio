import type { FormatInfo, VideoCodec } from '@shared/types'

/**
 * Rough download size per resolution, from the format list yt-dlp reported. Picks the formats the
 * download will most likely use (same preferences as the format selector) and adds the audio track.
 */

function size(f: FormatInfo, duration: number | null): number | null {
  if (f.filesize) return f.filesize
  if (f.tbr && duration) return (f.tbr * 1000 * duration) / 8
  return null
}

function videoScore(f: FormatInfo, codec: VideoCodec): number {
  let score = (f.height ?? 0) * 1000
  if (f.fps && f.fps >= 50) score += 200
  if (codec === 'compatible') {
    if (f.vcodec && f.vcodec.startsWith('avc1')) score += 400
    if (f.ext === 'mp4') score += 60
  } else {
    score += Math.min(300, (f.tbr ?? 0) / 10)
  }
  return score
}

function bestAudio(formats: FormatInfo[]): FormatInfo | null {
  const audio = formats.filter((f) => f.kind === 'audio')
  if (!audio.length) return null
  return audio.slice().sort((a, b) => (b.abr ?? b.tbr ?? 0) + (b.ext === 'm4a' ? 40 : 0) - ((a.abr ?? a.tbr ?? 0) + (a.ext === 'm4a' ? 40 : 0)))[0]
}

/** Estimated bytes for a download capped at height (0 = best), or null when unknown. */
export function estimateVideoSize(formats: FormatInfo[], height: number, duration: number | null, codec: VideoCodec, canMerge: boolean): number | null {
  const fits = (f: FormatInfo): boolean => !height || (f.height ?? 0) <= height
  if (!canMerge) {
    const muxed = formats.filter((f) => f.kind === 'muxed' && fits(f)).sort((a, b) => videoScore(b, codec) - videoScore(a, codec))[0]
    return muxed ? size(muxed, duration) : null
  }
  const video = formats.filter((f) => f.kind === 'video' && fits(f)).sort((a, b) => videoScore(b, codec) - videoScore(a, codec))[0]
  if (!video) return null
  const v = size(video, duration)
  const audio = bestAudio(formats)
  const a = audio ? size(audio, duration) : 0
  return v === null ? null : v + (a ?? 0)
}

/** Estimated bytes for audio only: the source track (conversion to MP3 at VBR 0 lands close to it). */
export function estimateAudioSize(formats: FormatInfo[], duration: number | null): number | null {
  const audio = bestAudio(formats)
  return audio ? size(audio, duration) : null
}
