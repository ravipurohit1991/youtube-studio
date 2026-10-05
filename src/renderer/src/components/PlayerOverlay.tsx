import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Gauge, Heart, ListPlus, Maximize, MonitorPlay, Music, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Video, X } from 'lucide-react'
import type { LibraryState } from '@shared/types'
import { formatDuration } from '../lib/format'
import { currentItem, hasStep } from '../lib/queue'
import type { PlayQueue, RepeatMode } from '../lib/types'
import { hideBroken, isInProgress } from './common'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

function stored(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    const value = raw === null ? NaN : Number(raw)
    return isFinite(value) ? value : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    /* preferences are best effort */
  }
}

/**
 * Plays library files one after another: the queue on the right, autoplay, shuffle, repeat,
 * speed, and it remembers where each item was left off.
 */
export default function PlayerOverlay({
  queue,
  libState,
  resume,
  onClose,
  onStep,
  onJump,
  onShuffle,
  onRepeat,
  onToggleFavorite,
  onAddToPlaylist,
}: {
  queue: PlayQueue
  libState: LibraryState
  resume: boolean
  onClose: () => void
  onStep: (delta: number) => void
  onJump: (pos: number) => void
  onShuffle: (on: boolean) => void
  onRepeat: (mode: RepeatMode) => void
  onToggleFavorite: (key: string) => void
  onAddToPlaylist: (key: string) => void
}): ReactNode {
  const item = currentItem(queue)
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const lastSaved = useRef(0)
  const [speed, setSpeed] = useState(() => stored('player.speed', 1))
  const [resumedAt, setResumedAt] = useState<number | null>(null)
  const progressRef = useRef(libState.progress)
  progressRef.current = libState.progress

  const save = useCallback((force = false) => {
    const media = mediaRef.current
    if (!media || !item || !isFinite(media.duration) || media.duration <= 0) return
    const now = Date.now()
    if (!force && now - lastSaved.current < 5000) return
    lastSaved.current = now
    void window.api.saveProgress(item.key, media.currentTime, media.duration)
  }, [item])

  useEffect(() => {
    lastSaved.current = 0
    setResumedAt(null)
  }, [item?.key])

  // Leaving an item (next, previous, jump, close) first records where it stopped.
  const close = useCallback(() => {
    save(true)
    onClose()
  }, [save, onClose])
  const step = useCallback((delta: number) => {
    save(true)
    onStep(delta)
  }, [save, onStep])
  const jump = (pos: number): void => {
    save(true)
    onJump(pos)
  }

  useEffect(() => {
    const media = mediaRef.current
    if (media) media.playbackRate = speed
    store('player.speed', speed)
  }, [speed, item?.key])

  const onLoaded = (): void => {
    const media = mediaRef.current
    if (!media || !item) return
    media.playbackRate = speed
    media.volume = Math.max(0, Math.min(1, stored('player.volume', 1)))
    const previous = progressRef.current[item.key]
    if (resume && isInProgress(previous) && previous) {
      media.currentTime = previous.position
      setResumedAt(previous.position)
    }
    void media.play().catch(() => undefined)
  }

  const onEnded = (): void => {
    const media = mediaRef.current
    if (media && item && isFinite(media.duration)) void window.api.saveProgress(item.key, media.duration, media.duration)
    if (queue.repeat === 'one' && media) {
      media.currentTime = 0
      void media.play().catch(() => undefined)
      return
    }
    if (hasStep(queue, 1)) onStep(1)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      const media = mediaRef.current
      const onMedia = target instanceof HTMLMediaElement
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') close()
      else if (key === 'n' && hasStep(queue, 1)) step(1)
      else if (key === 'p' && hasStep(queue, -1)) step(-1)
      else if (!media) return
      else if ((event.key === ' ' && !onMedia) || key === 'k') {
        event.preventDefault()
        if (media.paused) void media.play().catch(() => undefined)
        else media.pause()
      } else if (key === 'j') media.currentTime = Math.max(0, media.currentTime - 10)
      else if (key === 'l') media.currentTime = Math.min(media.duration || Infinity, media.currentTime + 10)
      else if (event.key === 'ArrowLeft' && !onMedia) media.currentTime = Math.max(0, media.currentTime - 5)
      else if (event.key === 'ArrowRight' && !onMedia) media.currentTime = Math.min(media.duration || Infinity, media.currentTime + 5)
      else if (key === 'm') media.muted = !media.muted
      else if (key === 'f') void toggleFullscreen()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step, queue])

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await frameRef.current?.requestFullscreen()
    } catch {
      /* fullscreen is best effort */
    }
  }

  if (!item) return null
  const favorite = libState.favorites.includes(item.key)
  const nextRepeat: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
  const media =
    item.kind === 'video' ? (
      <video
        key={item.key}
        ref={(el) => { mediaRef.current = el }}
        src={item.mediaUrl}
        controls
        playsInline
        onLoadedMetadata={onLoaded}
        onTimeUpdate={() => save()}
        onPause={() => save(true)}
        onEnded={onEnded}
        onVolumeChange={(event) => store('player.volume', event.currentTarget.volume)}
        onDoubleClick={() => void toggleFullscreen()}
      />
    ) : (
      <div className="audio-stage">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" onError={hideBroken} /> : <Music size={64} />}
        <audio
          key={item.key}
          ref={(el) => { mediaRef.current = el }}
          src={item.mediaUrl}
          controls
          onLoadedMetadata={onLoaded}
          onTimeUpdate={() => save()}
          onPause={() => save(true)}
          onEnded={onEnded}
          onVolumeChange={(event) => store('player.volume', event.currentTarget.volume)}
        />
      </div>
    )

  return (
    <div className="overlay" onClick={close} role="dialog" aria-modal="true">
      <div className={'overlay-inner' + (queue.items.length > 1 ? ' with-queue' : '')} onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 title={item.title ?? item.name}>{item.title ?? item.name}</h2>
            <div className="sub">
              {[item.uploader, item.folder, queue.items.length > 1 ? 'item ' + (queue.order[queue.pos] + 1) + ' of ' + queue.items.length : null]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="overlay-actions">
            <button type="button" className={'btn small' + (favorite ? ' on' : '')} onClick={() => onToggleFavorite(item.key)} title={favorite ? 'Remove from favorites' : 'Add to favorites'}>
              <Heart size={15} fill={favorite ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="btn small" onClick={() => onAddToPlaylist(item.key)} title="Add to playlist">
              <ListPlus size={15} />
            </button>
            <button type="button" className="btn small" onClick={() => void window.api.revealPath(item.absPath)} title="Show in folder">
              <FolderOpen size={15} />
            </button>
            <button type="button" className="btn small" onClick={() => void window.api.openPath(item.absPath)} title="Open in default player">
              <MonitorPlay size={15} />
            </button>
            <button type="button" className="btn small ghost" onClick={close} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="player-layout">
          <div className="player-main">
            <div className="video-frame" ref={frameRef}>{media}</div>
            <div className="player-bar">
              <button type="button" className="btn small" disabled={!hasStep(queue, -1)} onClick={() => step(-1)} title="Previous (P)">
                <SkipBack size={15} />
              </button>
              <button type="button" className="btn small" disabled={!hasStep(queue, 1)} onClick={() => step(1)} title="Next (N)">
                <SkipForward size={15} />
              </button>
              <button type="button" className={'btn small' + (queue.shuffle ? ' on' : '')} onClick={() => onShuffle(!queue.shuffle)} title="Shuffle">
                <Shuffle size={15} />
              </button>
              <button
                type="button"
                className={'btn small' + (queue.repeat !== 'off' ? ' on' : '')}
                onClick={() => onRepeat(nextRepeat[queue.repeat])}
                title={queue.repeat === 'off' ? 'Repeat: off' : queue.repeat === 'all' ? 'Repeat: all' : 'Repeat: this one'}
              >
                {queue.repeat === 'one' ? <Repeat1 size={15} /> : <Repeat size={15} />}
              </button>
              <label className="speed" title="Playback speed">
                <Gauge size={15} />
                <select className="select" value={String(speed)} onChange={(event) => setSpeed(Number(event.target.value))}>
                  {SPEEDS.map((value) => (
                    <option key={value} value={String(value)}>{value + 'x'}</option>
                  ))}
                </select>
              </label>
              {item.kind === 'video' ? (
                <button type="button" className="btn small" onClick={() => void toggleFullscreen()} title="Fullscreen (F)">
                  <Maximize size={15} />
                </button>
              ) : null}
              {resumedAt !== null ? (
                <span className="chip">
                  Resumed at {formatDuration(resumedAt)}
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      if (mediaRef.current) mediaRef.current.currentTime = 0
                      setResumedAt(null)
                    }}
                  >
                    Start over
                  </button>
                </span>
              ) : null}
              <span className="hint" style={{ marginLeft: 'auto' }}>Space play/pause · J/L 10s · N/P next/prev · F fullscreen</span>
            </div>
          </div>
          {queue.items.length > 1 ? (
            <aside className="upnext">
              <div className="upnext-title">Up next · {queue.items.length} items</div>
              <div className="upnext-list">
                {queue.order.map((index, pos) => {
                  const entry = queue.items[index]
                  const progress = libState.progress[entry.key]
                  return (
                    <button
                      key={entry.key + ':' + pos}
                      type="button"
                      className={'upnext-item' + (pos === queue.pos ? ' active' : '')}
                      onClick={() => jump(pos)}
                    >
                      <span className="upnext-thumb">
                        {entry.thumbnailUrl ? <img src={entry.thumbnailUrl} alt="" loading="lazy" onError={hideBroken} /> : entry.kind === 'audio' ? <Music size={16} /> : <Video size={16} />}
                      </span>
                      <span className="upnext-text">
                        <span className="upnext-name">{entry.title ?? entry.name}</span>
                        <span className="upnext-meta">
                          {entry.duration ? formatDuration(entry.duration) : entry.ext.toUpperCase()}
                          {progress?.watched ? ' · watched' : isInProgress(progress) ? ' · in progress' : ''}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  )
}
