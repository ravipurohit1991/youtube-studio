import type { ReactNode } from 'react'
import type { Chapter, Moment, SkipSegment } from '@shared/types'
import { formatDuration } from '../lib/format'
import { SEGMENT_LABELS } from '../lib/media'

/**
 * A slim map of the video under the player: chapters, sponsor segments that get skipped, the A–B loop,
 * and your saved moments. Click anywhere to jump there.
 */
export default function Timeline({
  duration,
  time,
  chapters = [],
  segments = [],
  moments = [],
  loop,
  onSeek,
}: {
  duration: number
  time: number
  chapters?: Chapter[]
  segments?: SkipSegment[]
  moments?: Moment[]
  loop?: { a: number | null; b: number | null }
  onSeek: (seconds: number) => void
}): ReactNode {
  if (!duration || !isFinite(duration)) return null
  const pct = (t: number): string => Math.max(0, Math.min(100, (t / duration) * 100)) + '%'
  const hasLoop = !!loop && loop.a !== null
  if (!chapters.length && !segments.length && !moments.length && !hasLoop) return null
  return (
    <div
      className="timeline"
      role="slider"
      aria-label="Video map"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        onSeek(((event.clientX - rect.left) / rect.width) * duration)
      }}
    >
      <div className="timeline-track">
        {chapters.slice(1).map((chapter) => (
          <span key={'c' + chapter.start} className="tl-chapter" style={{ left: pct(chapter.start) }} title={chapter.title} />
        ))}
        {segments.map((segment) => (
          <span
            key={'s' + segment.start}
            className="tl-segment"
            style={{ left: pct(segment.start), width: pct(segment.end - segment.start) }}
            title={'Skipped: ' + (SEGMENT_LABELS[segment.category] ?? segment.category) + ' ' + formatDuration(segment.start) + '–' + formatDuration(segment.end)}
          />
        ))}
        {hasLoop && loop ? (
          <span
            className={'tl-loop' + (loop.b === null ? ' open' : '')}
            style={{ left: pct(loop.a as number), width: loop.b !== null ? pct(loop.b - (loop.a as number)) : '2px' }}
            title={'Loop ' + formatDuration(loop.a) + (loop.b !== null ? '–' + formatDuration(loop.b) : '')}
          />
        ) : null}
        <span className="tl-played" style={{ width: pct(time) }} />
        {moments.map((moment) => (
          <button
            key={moment.id}
            type="button"
            className="tl-moment"
            style={{ left: pct(moment.at) }}
            title={formatDuration(moment.at) + (moment.note ? ' · ' + moment.note : ' · saved moment')}
            onClick={(event) => {
              event.stopPropagation()
              onSeek(moment.at)
            }}
          />
        ))}
      </div>
    </div>
  )
}
