import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Heart, Music, Video } from 'lucide-react'
import { clampPercent } from '../lib/api'
import { formatDuration } from '../lib/format'
import type { JobStatus, LibraryItem, WatchProgress } from '@shared/types'

export function ProgressBar({ value, status }: { value: number; status?: JobStatus }): ReactNode {
  // No byte counts yet (starting up, waiting in line) or post-processing: show motion instead of a frozen bar.
  const busy = status === 'processing' || status === 'queued' || (status === 'downloading' && value <= 0)
  const cls =
    status === 'completed' ? 'progress done'
      : status === 'error' || status === 'canceled' ? 'progress failed'
        : status === 'paused' ? 'progress paused'
          : busy ? 'progress busy' : 'progress'
  return (
    <div className={cls}>
      <span style={{ width: clampPercent(value) + '%' }} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  message,
  children,
}: {
  icon: ReactNode
  title: string
  message: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {children ? <div className="row tight" style={{ justifyContent: 'center', marginTop: 6 }}>{children}</div> : null}
    </div>
  )
}

/** A labelled toggle switch (a styled checkbox). */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: ReactNode
  disabled?: boolean
  title?: string
}): ReactNode {
  return (
    <label className={'switch' + (disabled ? ' disabled' : '')} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="track" />
      {label !== undefined ? <span>{label}</span> : null}
    </label>
  )
}

/** One row of a settings-style list: title and explanation on the left, the control on the right. */
export function OptionRow({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="option-row">
      <div className="option-text">
        <div className="option-title">{title}</div>
        {hint ? <div className="option-hint">{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

/** On a Mac the shortcuts written as Ctrl+… are pressed (and shown) with Command. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
export const MOD = IS_MAC ? '⌘' : 'Ctrl'

export function Kbd({ keys }: { keys: string }): ReactNode {
  return (
    <>
      {keys.split('+').map((k) => (
        <kbd key={k}>{k === 'Ctrl' ? MOD : k}</kbd>
      ))}
    </>
  )
}

export function LoadingRow({ label }: { label: string }): ReactNode {
  return (
    <div className="loading-row">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  )
}

export function StatusDot({ ok, busy }: { ok: boolean; busy?: boolean }): ReactNode {
  return <span className={'dot ' + (busy ? 'busy' : ok ? 'ok' : 'bad')} />
}

export interface MenuEntry {
  label: string
  icon?: ReactNode
  danger?: boolean
  onSelect: () => void
}

/** A "more" button with a small dropdown menu; closes on outside click or Escape. */
export function MoreMenu({ items, label = 'More', className = 'btn small ghost', icon }: { items: MenuEntry[]; label?: string; className?: string; icon: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref} onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" className={className} title={label} aria-label={label} onClick={(event) => { event.stopPropagation(); setOpen((v) => !v) }}>
        {icon}
      </button>
      {open ? (
        <div className="menu" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={'menu-item' + (item.danger ? ' danger' : '')}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                item.onSelect()
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Small modal with one text field (Electron has no window.prompt). */
export function PromptDialog({
  title,
  initial = '',
  confirm,
  placeholder,
  onConfirm,
  onCancel,
}: {
  title: string
  initial?: string
  confirm: string
  placeholder?: string
  onConfirm: (value: string) => void
  onCancel: () => void
}): ReactNode {
  const [value, setValue] = useState(initial)
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim()) onConfirm(value.trim())
        }}
      >
        <h3>{title}</h3>
        <input
          className="input"
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel()
          }}
        />
        <div className="row tight" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>{confirm}</button>
        </div>
      </form>
    </div>
  )
}

/** Thumbnail with duration, a watched check and a progress line for partly watched items. */
export function MediaThumb({
  item,
  progress,
  favorite,
  onToggleFavorite,
}: {
  item: LibraryItem
  progress: WatchProgress | undefined
  favorite?: boolean
  onToggleFavorite?: () => void
}): ReactNode {
  const fraction = progress && progress.duration > 0 ? Math.min(1, progress.position / progress.duration) : 0
  const partly = !!progress && !progress.watched && progress.position > 5 && fraction < 0.95
  const [broken, setBroken] = useState(false)
  return (
    <div className="thumb">
      <span className="kind-badge">{item.kind}</span>
      {item.thumbnailUrl && !broken ? (
        <img src={item.thumbnailUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="placeholder">{item.kind === 'audio' ? <Music size={26} /> : <Video size={26} />}</div>
      )}
      {item.duration ? <span className="duration">{formatDuration(item.duration)}</span> : null}
      {progress?.watched ? (
        <span className="watched-badge" title="Watched">
          <Check size={12} />
          watched
        </span>
      ) : null}
      {onToggleFavorite ? (
        <button
          type="button"
          className={'fav-btn' + (favorite ? ' on' : '')}
          title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite()
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Heart size={14} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      ) : null}
      {partly ? (
        <div className="progress-line">
          <span style={{ width: fraction * 100 + '%' }} />
        </div>
      ) : null}
    </div>
  )
}

export function isInProgress(progress: WatchProgress | undefined): boolean {
  if (!progress || progress.watched || progress.duration <= 0) return false
  return progress.position > 5 && progress.position / progress.duration < 0.95
}

/** For small decorative thumbnails: hide the image instead of showing a broken-image icon. */
export function hideBroken(event: { currentTarget: HTMLImageElement }): void {
  event.currentTarget.style.visibility = 'hidden'
}
