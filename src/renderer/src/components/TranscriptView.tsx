import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, Crosshair, Search, X } from 'lucide-react'
import type { Transcript } from '@shared/types'
import { formatDuration } from '../lib/format'
import { activeLine, groupLines } from '../lib/media'

/** Split text around the words of query (case-insensitive), marking the matches. */
export function Highlight({ text, terms }: { text: string; terms: string[] }): ReactNode {
  const words = terms.map((t) => t.trim()).filter(Boolean)
  if (!words.length) return text
  const pattern = new RegExp('(' + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|') + ')', 'gi')
  const parts = text.split(pattern)
  return parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>))
}

/**
 * The words of a video, following playback: the line being said is highlighted and kept in view, any
 * line jumps there, and the filter finds every place a word is said.
 */
export default function TranscriptView({
  transcript,
  loading,
  error,
  time,
  onSeek,
  emptyHint,
  maxHeight,
}: {
  transcript: Transcript | null
  loading: boolean
  error: string | null
  time: number
  onSeek: (seconds: number) => void
  emptyHint?: string
  maxHeight?: number | string
}): ReactNode {
  const [filter, setFilter] = useState('')
  const [follow, setFollow] = useState(true)
  const listRef = useRef<HTMLDivElement | null>(null)
  const lastAuto = useRef(0)
  const lines = useMemo(() => (transcript ? groupLines(transcript.lines) : []), [transcript])
  const current = activeLine(lines, time)
  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const indexed = useMemo(() => lines.map((line, index) => ({ line, index, lower: line.text.toLowerCase() })), [lines])
  const shown = words.length ? indexed.filter((entry) => words.every((w) => entry.lower.includes(w))) : indexed

  useEffect(() => {
    if (!follow || words.length || current < 0) return
    const list = listRef.current
    const el = list?.querySelector('[data-line="' + current + '"]') as HTMLElement | null
    if (!list || !el) return
    const top = el.offsetTop - list.offsetTop
    if (top < list.scrollTop + 30 || top > list.scrollTop + list.clientHeight - 60) {
      lastAuto.current = Date.now()
      list.scrollTo({ top: Math.max(0, top - list.clientHeight / 3), behavior: 'smooth' })
    }
  }, [current, follow, words.length])

  const copy = async (): Promise<void> => {
    if (!transcript) return
    try {
      await navigator.clipboard.writeText(lines.map((l) => '[' + formatDuration(l.start) + '] ' + l.text).join('\n'))
    } catch {
      /* clipboard is best effort */
    }
  }

  if (loading) {
    return (
      <div className="transcript-empty">
        <span className="spinner" />
        <span>Reading the captions…</span>
      </div>
    )
  }
  if (error) return <div className="transcript-empty err">{error}</div>
  if (!transcript || !lines.length) {
    return <div className="transcript-empty">{emptyHint ?? 'This one has no captions, so there is no transcript.'}</div>
  }

  return (
    <div className="transcript">
      <div className="transcript-tools">
        <div className="search-wrap" style={{ flex: 1 }}>
          <Search size={13} />
          <input className="input" placeholder="Find in transcript…" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Find in transcript" />
        </div>
        {filter ? (
          <button type="button" className="btn small ghost icon" onClick={() => setFilter('')} title="Clear" aria-label="Clear filter">
            <X size={13} />
          </button>
        ) : null}
        <button type="button" className={'btn small ghost icon' + (follow ? ' on' : '')} onClick={() => setFollow(!follow)} title={follow ? 'Following playback (click to stop)' : 'Follow playback'} aria-label="Follow playback">
          <Crosshair size={13} />
        </button>
        <button type="button" className="btn small ghost icon" onClick={() => void copy()} title="Copy the transcript" aria-label="Copy the transcript">
          <Copy size={13} />
        </button>
      </div>
      <div
        className="transcript-lines"
        ref={listRef}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
        onWheel={() => {
          // Scrolling by hand pauses following, so the list does not jump away from what you read.
          if (Date.now() - lastAuto.current > 600 && follow) setFollow(false)
        }}
      >
        {words.length ? <div className="hint" style={{ padding: '2px 4px 6px' }}>{shown.length ? shown.length + ' line(s) with "' + filter.trim() + '"' : 'Not said in this video.'}</div> : null}
        {shown.map(({ line, index }) => {
          return (
            <button
              key={line.start + ':' + index}
              type="button"
              data-line={index}
              className={'tline' + (index === current ? ' active' : '') + (index < current ? ' past' : '')}
              onClick={() => onSeek(line.start)}
            >
              <span className="tline-time">{formatDuration(line.start)}</span>
              <span className="tline-text"><Highlight text={line.text} terms={words} /></span>
            </button>
          )
        })}
      </div>
      <div className="transcript-foot hint">
        {transcript.source === 'subtitles' ? 'From the subtitle file' : transcript.auto ? 'YouTube automatic captions' : 'YouTube captions'}
        {transcript.lang ? ' · ' + transcript.lang : ''}
      </div>
    </div>
  )
}
