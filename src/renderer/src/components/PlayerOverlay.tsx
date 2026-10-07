import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  FolderOpen,
  Gauge,
  Heart,
  Keyboard,
  ListPlus,
  Maximize,
  MonitorPlay,
  Moon,
  Music,
  PictureInPicture2,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Video,
  X,
} from 'lucide-react'
import type { LibraryState } from '@shared/types'
import { formatDuration } from '../lib/format'
import { currentItem, hasStep } from '../lib/queue'
import type { PlayQueue, RepeatMode } from '../lib/types'
import { Kbd, hideBroken, isInProgress } from './common'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
/** Minutes; -1 = at the end of the current item. */
const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90, -1]

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

const SHORTCUTS: Array<[string, string]> = [
  ['Space', 'Play / pause'],
  ['J', 'Back 10 seconds'],
  ['L', 'Forward 10 seconds'],
  ['←', 'Back 5 seconds'],
  ['→', 'Forward 5 seconds'],
  ['↑', 'Volume up'],
  ['↓', 'Volume down'],
  ['0-9', 'Jump to 0%-90%'],
  ['Shift+.', 'Faster'],
  ['Shift+,', 'Slower'],
  ['M', 'Mute'],
  ['C', 'Subtitles on / off'],
  ['F', 'Fullscreen'],
  ['I', 'Picture-in-picture'],
  ['N', 'Next'],
  ['P', 'Previous'],
  ['Esc', 'Close'],
]

/**
 * Plays library files one after another: the queue on the right, autoplay, shuffle, repeat, speed,
 * subtitles, picture-in-picture, a sleep timer, and it remembers where each item was left off.
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
  const [sleep, setSleep] = useState(0)
  const [sleepAt, setSleepAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [showKeys, setShowKeys] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const progressRef = useRef(libState.progress)
  progressRef.current = libState.progress

  const save = useCallback((force = false) => {
    const media = mediaRef.current
    if (!media || !item || !isFinite(media.duration) || media.duration <= 0) return
    const stamp = Date.now()
    if (!force && stamp - lastSaved.current < 5000) return
    lastSaved.current = stamp
    void window.api.saveProgress(item.key, media.currentTime, media.duration)
  }, [item])

  useEffect(() => {
    lastSaved.current = 0
    setResumedAt(null)
  }, [item?.key])

  // Leaving an item (next, previous, jump, close) first records where it stopped.
  const close = useCallback(() => {
    save(true)
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined)
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

  // Sleep timer: a countdown, or "at the end of this item" (handled in onEnded).
  useEffect(() => {
    if (sleep > 0) setSleepAt(Date.now() + sleep * 60000)
    else setSleepAt(null)
  }, [sleep])
  useEffect(() => {
    if (sleepAt === null) return undefined
    const timer = window.setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= sleepAt) {
        mediaRef.current?.pause()
        setSleep(0)
        setFlash('Sleep timer: paused')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sleepAt])

  useEffect(() => {
    if (!flash) return undefined
    const timer = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(timer)
  }, [flash])

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
    if (sleep === -1) {
      setSleep(0)
      setFlash('Sleep timer: stopped after this one')
      return
    }
    if (queue.repeat === 'one' && media) {
      media.currentTime = 0
      void media.play().catch(() => undefined)
      return
    }
    if (hasStep(queue, 1)) onStep(1)
  }

  const toggleFullscreen = useCallback(async (): Promise<void> => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await frameRef.current?.requestFullscreen()
    } catch {
      /* fullscreen is best effort */
    }
  }, [])

  const togglePip = useCallback(async (): Promise<void> => {
    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement)) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await media.requestPictureInPicture()
    } catch {
      setFlash('Picture-in-picture is not available')
    }
  }, [])

  const toggleSubtitles = useCallback(() => {
    const media = mediaRef.current
    if (!(media instanceof HTMLVideoElement) || !media.textTracks.length) {
      setFlash('No subtitles for this one')
      return
    }
    const tracks = Array.from(media.textTracks)
    const showing = tracks.findIndex((t) => t.mode === 'showing')
    tracks.forEach((t) => (t.mode = 'disabled'))
    const next = showing + 1
    if (next < tracks.length) {
      tracks[next].mode = 'showing'
      setFlash('Subtitles: ' + (tracks[next].label || tracks[next].language))
    } else setFlash('Subtitles off')
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const media = mediaRef.current
      const onMedia = target instanceof HTMLMediaElement
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') {
        if (showKeys) setShowKeys(false)
        else close()
      } else if (event.key === '?') setShowKeys((v) => !v)
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
      else if (event.key === 'ArrowUp' && !onMedia) {
        event.preventDefault()
        media.volume = Math.min(1, media.volume + 0.05)
        setFlash('Volume ' + Math.round(media.volume * 100) + '%')
      } else if (event.key === 'ArrowDown' && !onMedia) {
        event.preventDefault()
        media.volume = Math.max(0, media.volume - 0.05)
        setFlash('Volume ' + Math.round(media.volume * 100) + '%')
      } else if (/^[0-9]$/.test(event.key) && isFinite(media.duration)) media.currentTime = (Number(event.key) / 10) * media.duration
      else if (event.key === '>' || event.key === '<') {
        const index = SPEEDS.indexOf(speed)
        const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (index < 0 ? 2 : index) + (event.key === '>' ? 1 : -1)))]
        setSpeed(next)
        setFlash(next + 'x')
      } else if (key === 'm') media.muted = !media.muted
      else if (key === 'f') void toggleFullscreen()
      else if (key === 'i') void togglePip()
      else if (key === 'c') toggleSubtitles()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step, queue, showKeys, speed, toggleFullscreen, togglePip, toggleSubtitles])

  if (!item) return null
  const favorite = libState.favorites.includes(item.key)
  const nextRepeat: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
  const tracks = item.subtitles.map((sub) => <track key={sub.url} kind="subtitles" src={sub.url} srcLang={sub.lang} label={sub.lang.toUpperCase()} />)
  const media =
    item.kind === 'video' ? (
      <video
        key={item.key}
        ref={(el) => { mediaRef.current = el }}
        src={item.mediaUrl}
        controls
        playsInline
        crossOrigin={item.subtitles.length ? 'anonymous' : undefined}
        onLoadedMetadata={onLoaded}
        onTimeUpdate={() => save()}
        onPause={() => save(true)}
        onEnded={onEnded}
        onVolumeChange={(event) => store('player.volume', event.currentTarget.volume)}
        onDoubleClick={() => void toggleFullscreen()}
      >
        {tracks}
      </video>
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

  const sleepLeft = sleepAt !== null ? Math.max(0, Math.round((sleepAt - now) / 1000)) : null

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
            <div className="video-frame" ref={frameRef} style={{ position: 'relative' }}>
              {media}
              {flash ? (
                <span className="chip" style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', color: '#fff', borderColor: 'transparent' }}>
                  {flash}
                </span>
              ) : null}
            </div>
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
              <span className="sep" />
              <label className="speed" title="Playback speed">
                <Gauge size={15} />
                <select className="select" value={String(speed)} onChange={(event) => setSpeed(Number(event.target.value))}>
                  {SPEEDS.map((value) => (
                    <option key={value} value={String(value)}>{value + 'x'}</option>
                  ))}
                </select>
              </label>
              <label className="speed" title="Sleep timer">
                <Moon size={15} />
                <select className="select" value={String(sleep)} onChange={(event) => setSleep(Number(event.target.value))}>
                  {SLEEP_OPTIONS.map((value) => (
                    <option key={value} value={String(value)}>{value === 0 ? 'Sleep: off' : value === -1 ? 'End of this item' : value + ' min'}</option>
                  ))}
                </select>
              </label>
              {sleepLeft !== null ? <span className="chip soft">{formatDuration(sleepLeft)} left</span> : null}
              {item.kind === 'video' ? (
                <>
                  <button type="button" className="btn small" onClick={() => void togglePip()} title="Picture-in-picture (I)">
                    <PictureInPicture2 size={15} />
                  </button>
                  <button type="button" className="btn small" onClick={() => void toggleFullscreen()} title="Fullscreen (F)">
                    <Maximize size={15} />
                  </button>
                </>
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
              <button type="button" className={'btn small ghost' + (showKeys ? ' on' : '')} style={{ marginLeft: 'auto' }} onClick={() => setShowKeys((v) => !v)} title="Keyboard shortcuts (?)">
                <Keyboard size={15} />
                <span>Shortcuts</span>
              </button>
            </div>
            {showKeys ? (
              <div className="card" style={{ marginTop: 12 }}>
                <div className="shortcut-grid" style={{ gridTemplateColumns: 'auto 1fr auto 1fr auto 1fr' }}>
                  {SHORTCUTS.map(([keys, label]) => (
                    <div key={keys} style={{ display: 'contents' }}>
                      <span><Kbd keys={keys} /></span>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
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
