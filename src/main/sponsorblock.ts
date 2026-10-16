import { createHash } from 'node:crypto'
import type { SkipSegment } from '@shared/types'
import { log } from './logger'

/**
 * SponsorBlock segments for skipping while watching (downloads cut them out with yt-dlp instead).
 * Privacy: only the first 4 hex characters of the video id's SHA-256 are sent, and the matching video
 * is picked out of the answer here, so the server never learns which video is being watched.
 */

const CATEGORIES = ['sponsor', 'selfpromo', 'interaction']
const TTL = 60 * 60 * 1000
const cache = new Map<string, { at: number; segments: SkipSegment[] }>()

function base(): string {
  return (process.env.YTD_SPONSORBLOCK_URL || 'https://sponsor.ajay.app').replace(/\/+$/, '')
}

interface ApiVideo {
  videoID?: string
  segments?: { segment?: [number, number]; category?: string; actionType?: string }[]
}

export async function sponsorSegments(videoId: string): Promise<SkipSegment[]> {
  if (!/^[\w-]{11}$/.test(videoId)) return []
  const hit = cache.get(videoId)
  if (hit && Date.now() - hit.at < TTL) return hit.segments
  const prefix = createHash('sha256').update(videoId).digest('hex').slice(0, 4)
  const url = base() + '/api/skipSegments/' + prefix + '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES)) + '&actionTypes=' + encodeURIComponent('["skip"]')
  let segments: SkipSegment[] = []
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'YTD-Studio' }, signal: AbortSignal.timeout(7000) })
    if (response.ok) {
      const list = (await response.json()) as ApiVideo[]
      const video = Array.isArray(list) ? list.find((v) => v && v.videoID === videoId) : undefined
      segments = (video?.segments ?? [])
        .filter((s) => Array.isArray(s.segment) && (!s.actionType || s.actionType === 'skip') && s.segment[1] - s.segment[0] >= 1)
        .map((s) => ({ start: Math.max(0, s.segment![0]), end: s.segment![1], category: String(s.category ?? 'sponsor') }))
        .sort((a, b) => a.start - b.start)
    } else if (response.status !== 404) {
      log('sponsorblock: status', response.status)
      return []
    }
  } catch (err) {
    // Offline or blocked: watching simply goes on without skipping (and asks again next time).
    log('sponsorblock: unavailable', err instanceof Error ? err.message : String(err))
    return []
  }
  cache.set(videoId, { at: Date.now(), segments })
  return segments
}
