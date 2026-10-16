import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Trash2 } from 'lucide-react'
import type { Moment } from '@shared/types'
import { formatDuration, timeAgo } from '../lib/format'

/** One saved moment: its time (click to open it there), an editable note, and delete. */
export default function MomentRow({
  moment,
  onOpen,
  autoFocus,
  active,
}: {
  moment: Moment
  onOpen: (moment: Moment) => void
  autoFocus?: boolean
  active?: boolean
}): ReactNode {
  const [note, setNote] = useState(moment.note)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setNote(moment.note), [moment.note])
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const save = (): void => {
    if (note !== moment.note) void window.api.momentUpdate(moment.id, note)
  }

  return (
    <div className={'moment-row' + (active ? ' active' : '')}>
      <button type="button" className="moment-time" onClick={() => onOpen(moment)} title={'Open at ' + formatDuration(moment.at)}>
        {formatDuration(moment.at)}
      </button>
      <input
        ref={inputRef}
        className="moment-note"
        value={note}
        placeholder="Add a note…"
        aria-label="Note"
        onChange={(event) => setNote(event.target.value)}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            save()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            setNote(moment.note)
            event.currentTarget.blur()
          }
          event.stopPropagation()
        }}
      />
      <span className="moment-age" title={new Date(moment.createdAt).toLocaleString()}>{timeAgo(moment.createdAt)}</span>
      <button type="button" className="icon-btn" title="Delete this moment" aria-label="Delete this moment" onClick={() => void window.api.momentRemove(moment.id)}>
        <Trash2 size={13} />
      </button>
    </div>
  )
}
