/**
 * A downloaded file is not always the whole video: a clip (--download-sections) starts later, and
 * SponsorBlock removal (--sponsorblock-remove) cuts parts out. YouTube's captions and the chapters in the
 * .info.json follow the full video, so their times must be moved onto the file's own timeline.
 *
 * yt-dlp writes the .info.json after the SponsorBlock step and before cutting, so the sidecar lists the
 * removed segments (sponsorblock_chapters) and the section that was downloaded (section_start/_end).
 */

/** The SponsorBlock categories downloads remove (the same list is passed to yt-dlp). */
export const SPONSORBLOCK_REMOVE = ['sponsor', 'selfpromo', 'interaction']

export interface Timeline {
  /** A time of the full video on the file's timeline, or null when that moment is not in the file. */
  map: (seconds: number) => number | null
  /** Like map, but a moment that was cut out moves to where the file continues (for chapter starts). */
  snap: (seconds: number) => number | null
}

interface Cut {
  start: number
  end: number
}

function num(value: unknown): number | null {
  return typeof value === 'number' && isFinite(value) ? value : null
}

/**
 * The file's timeline from its .info.json, or null when the file is the whole video (nothing to move).
 * withCuts: false ignores removed segments (subtitle files written by yt-dlp are already cut with the video).
 */
export function fileTimeline(info: Record<string, unknown> | null, withCuts = true): Timeline | null {
  if (!info) return null
  const from = Math.max(0, num(info.section_start) ?? 0)
  const to = num(info.section_end) ?? Infinity
  const raw = withCuts && Array.isArray(info.sponsorblock_chapters) ? (info.sponsorblock_chapters as Record<string, unknown>[]) : []
  const cuts: Cut[] = []
  raw
    .filter((c) => c && SPONSORBLOCK_REMOVE.includes(String(c.category)) && (c.type === undefined || c.type === 'skip'))
    .map((c) => ({ start: Math.max(from, num(c.start_time) ?? 0), end: Math.min(to, num(c.end_time) ?? 0) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start)
    .forEach((c) => {
      // Overlapping and touching segments are one cut, as yt-dlp merges them.
      const last = cuts[cuts.length - 1]
      if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
      else cuts.push({ ...c })
    })
  if (from === 0 && to === Infinity && !cuts.length) return null
  const removedBefore = (t: number): number => cuts.reduce((sum, c) => sum + (c.end <= t ? c.end - c.start : 0), 0)
  const map = (t: number): number | null => {
    if (t < from || t >= to) return null
    if (cuts.some((c) => t >= c.start && t < c.end)) return null
    return t - from - removedBefore(t)
  }
  const snap = (t: number): number | null => {
    if (t >= to) return null
    const clamped = Math.max(from, t)
    const inside = cuts.find((c) => clamped >= c.start && clamped < c.end)
    return map(inside ? inside.end : clamped)
  }
  return { map, snap }
}
