import { useCallback, useEffect, useRef, useState } from 'react'
import type { SkipSegment, TranscriptLine } from '@shared/types'

/** The media element's current time as state, a few times a second (and right after every seek). */
export function useMediaTime(media: HTMLMediaElement | null, perSecond = 4): number {
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!media) {
      setTime(0)
      return undefined
    }
    let last = 0
    const onTime = (): void => {
      const now = performance.now()
      if (now - last < 1000 / perSecond) return
      last = now
      setTime(media.currentTime)
    }
    const onSeeked = (): void => setTime(media.currentTime)
    media.addEventListener('timeupdate', onTime)
    media.addEventListener('seeked', onSeeked)
    setTime(media.currentTime)
    return () => {
      media.removeEventListener('timeupdate', onTime)
      media.removeEventListener('seeked', onSeeked)
    }
  }, [media, perSecond])
  return time
}

/** The media element's duration as state (0 until known). */
export function useMediaDuration(media: HTMLMediaElement | null): number {
  const [duration, setDuration] = useState(0)
  useEffect(() => {
    if (!media) {
      setDuration(0)
      return undefined
    }
    const update = (): void => setDuration(isFinite(media.duration) ? media.duration : 0)
    update()
    media.addEventListener('loadedmetadata', update)
    media.addEventListener('durationchange', update)
    return () => {
      media.removeEventListener('loadedmetadata', update)
      media.removeEventListener('durationchange', update)
    }
  }, [media])
  return duration
}

export const SEGMENT_LABELS: Record<string, string> = {
  sponsor: 'sponsor',
  selfpromo: 'self-promotion',
  interaction: '"like and subscribe"',
  intro: 'intro',
  outro: 'outro',
}

/**
 * SponsorBlock while watching: fetches the segments of videoId and jumps over them as playback reaches
 * one. Undo plays the skipped segment after all (and leaves it alone from then on). guard() can veto
 * skipping, e.g. for a file that was already downloaded with the sponsors cut out.
 */
export function useSponsorSkip(
  media: HTMLMediaElement | null,
  videoId: string | null,
  enabled: boolean,
  guard?: (media: HTMLMediaElement) => boolean,
): { segments: SkipSegment[]; skipped: SkipSegment | null; undo: () => void; count: number } {
  const [segments, setSegments] = useState<SkipSegment[]>([])
  const [skipped, setSkipped] = useState<SkipSegment | null>(null)
  const [count, setCount] = useState(0)
  const allowed = useRef(new Set<number>())
  const guardRef = useRef(guard)
  guardRef.current = guard

  useEffect(() => {
    setSegments([])
    setSkipped(null)
    setCount(0)
    allowed.current = new Set()
    if (!enabled || !videoId) return undefined
    let gone = false
    void window.api.sponsorSegments(videoId).then((result) => {
      if (!gone && result.ok) setSegments(result.data)
    })
    return () => {
      gone = true
    }
  }, [videoId, enabled])

  useEffect(() => {
    if (!media || !segments.length) return undefined
    const onTime = (): void => {
      if (media.paused && media.readyState < 2) return
      if (guardRef.current && !guardRef.current(media)) return
      const t = media.currentTime
      const hit = segments.find((s) => t >= s.start && t < s.end - 0.4 && !allowed.current.has(s.start))
      if (!hit) return
      media.currentTime = Math.min(hit.end, isFinite(media.duration) ? media.duration : hit.end)
      setSkipped(hit)
      setCount((n) => n + 1)
    }
    media.addEventListener('timeupdate', onTime)
    return () => media.removeEventListener('timeupdate', onTime)
  }, [media, segments])

  useEffect(() => {
    if (!skipped) return undefined
    const timer = window.setTimeout(() => setSkipped(null), 7000)
    return () => window.clearTimeout(timer)
  }, [skipped])

  const undo = useCallback(() => {
    if (!skipped || !media) return
    allowed.current.add(skipped.start)
    media.currentTime = skipped.start
    void media.play().catch(() => undefined)
    setSkipped(null)
  }, [skipped, media])

  return { segments: enabled ? segments : [], skipped, undo, count }
}

/** Index of the line playing at time (the last one that started), or -1 before the first. */
export function activeLine(lines: { start: number }[], time: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= time + 0.25) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** Short caption lines joined into readable sentences of about maxChars (or until a pause). */
export function groupLines(lines: TranscriptLine[], maxChars = 110): TranscriptLine[] {
  const out: TranscriptLine[] = []
  lines.forEach((line) => {
    const last = out[out.length - 1]
    const gap = last ? line.start - last.start : Infinity
    if (last && last.text.length + line.text.length < maxChars && gap < 12 && !/[.?!]["')\]]?$/.test(last.text)) {
      last.text += ' ' + line.text
    } else out.push({ start: line.start, text: line.text })
  })
  return out
}

/** The chapter playing at time. */
export function chapterAt<T extends { start: number }>(chapters: T[], time: number): T | null {
  const index = activeLine(chapters, time)
  return index >= 0 ? chapters[index] : null
}
