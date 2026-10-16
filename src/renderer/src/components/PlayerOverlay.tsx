import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BookmarkPlus,
  Camera,
  Captions,
  FileDown,
  FolderOpen,
  Gauge,
  Heart,
  Keyboard,
  Link,
  ListOrdered,
  ListPlus,
  ListVideo,
  Loader2,
  Maximize,
  MonitorPlay,
  Moon,
  Music,
  PictureInPicture2,
  Repeat,
  Repeat1,
  Repeat2,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  StickyNote,
  Video,
  X,
} from 'lucide-react'
import type { ClipFormat, LibraryState, Moment, Settings, Transcript } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatDuration } from '../lib/format'
import { SEGMENT_LABELS, chapterAt, useMediaDuration, useMediaTime, useSponsorSkip } from '../lib/media'
import { usePref } from '../lib/prefs'
import { currentItem, hasStep } from '../lib/queue'
import type { PlayQueue, PushToast, RepeatMode } from '../lib/types'
import { Kbd, MoreMenu, hideBroken, isInProgress } from './common'
import MomentRow from './MomentRow'
import Timeline from './Timeline'
import TranscriptView from './TranscriptView'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
/** Minutes; -1 = at the end of the current item. */
const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90, -1]

type SideTab = 'upnext' | 'transcript' | 'chapters' | 'moments'

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
  ['B', 'Save this moment'],
  ['[', 'Loop from here (A)'],
  [']', 'Loop to here (B)'],
  ['\\', 'Stop looping'],
  ['S', 'Snapshot of this frame'],
  ['T', 'Show the transcript'],
  ['N', 'Next'],
  ['P', 'Previous'],
  ['Esc', 'Close'],
]

/**
 * Plays library files one after another: the queue, autoplay, shuffle, repeat, speed, subtitles,
 * picture-in-picture, a sleep timer and resume. Next to the video: up next, the transcript following
 * playback, chapters and your saved moments. Loop a part (A–B) and save it as a clip, GIF or MP3, grab
 * a frame, and sponsor segments are skipped as they come.
 */
export default function PlayerOverlay({
  queue,
  libState,
  settings,
  moments,
  ffmpegOk,
  pushToast,
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
  settings: Settings
  moments: Moment[]
  ffmpegOk: boolean
  pushToast: PushToast
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
  const [mediaEl, setMediaEl] = useState<HTMLVideoElement | HTMLAudioElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const lastSaved = useRef(0)
  const usedStart = useRef(0)
  const [speed, setSpeed] = useState(() => stored('player.speed', 1))
  const [resumedAt, setResumedAt] = useState<number | null>(null)
  const [sleep, setSleep] = useState(0)
  const [sleepAt, setSleepAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [showKeys, setShowKeys] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [loop, setLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null })
  const [busy, setBusy] = useState<string | null>(null)
  const [savedTab, setSavedTab] = usePref<SideTab>('player.side', 'transcript')
  const [focusMoment, setFocusMoment] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<Record<string, { loading: boolean; error: string | null; data: Transcript | null }>>({})
  const progressRef = useRef(libState.progress)
  progressRef.current = libState.progress
  const loopRef = useRef(loop)
  loopRef.current = loop

  const setMedia = useCallback((el: HTMLVideoElement | HTMLAudioElement | null) => {
    mediaRef.current = el
    setMediaEl(el)
  }, [])

  const time = useMediaTime(mediaEl)
  const duration = useMediaDuration(mediaEl)
  const chapters = item?.chapters ?? []
  const chapter = chapterAt(chapters, time)
  const itemMoments = useMemo(
    () => (item ? moments.filter((m) => m.key === item.key || (!!item.videoId && m.videoId === item.videoId)).sort((a, b) => a.at - b.at) : []),
    [moments, item],
  )

  // A file downloaded with SponsorBlock (or a clip) no longer matches YouTube's timeline: only skip when
  // the file is as long as the video.
  const sponsorGuard = useCallback(
    (media: HTMLMediaElement) => !!item?.duration && isFinite(media.duration) && Math.abs(media.duration - item.duration) < 3,
    [item?.duration],
  )
  const sponsor = useSponsorSkip(mediaEl, item?.videoId ?? null, settings.skipSponsorsLive && !!item?.videoId, sponsorGuard)
  const sponsorActive = sponsor.segments.length > 0 && !!mediaEl && duration > 0 && !!item?.duration && Math.abs(duration - item.duration) < 3

  const sideTabs: SideTab[] = [
    ...(queue.items.length > 1 ? (['upnext'] as SideTab[]) : []),
    'transcript',
    ...(chapters.length ? (['chapters'] as SideTab[]) : []),
    'moments',
  ]
  const side: SideTab = sideTabs.includes(savedTab) ? savedTab : sideTabs[0]

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
    setLoop({ a: null, b: null })
  }, [item?.key])

  // The transcript is read when its tab is shown (it may fetch captions once for a file that has none yet).
  useEffect(() => {
    if (!item || side !== 'transcript' || transcripts[item.key]) return
    const key = item.key
    setTranscripts((prev) => ({ ...prev, [key]: { loading: true, error: null, data: null } }))
    void unwrap(window.api.transcriptGet(key))
      .then((data) => setTranscripts((prev) => ({ ...prev, [key]: { loading: false, error: null, data } })))
      .catch((err) => setTranscripts((prev) => ({ ...prev, [key]: { loading: false, error: 'Could not read the captions: ' + errorMessage(err), data: null } })))
  }, [item, side, transcripts])

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

  const seek = useCallback((seconds: number) => {
    const media = mediaRef.current
    if (!media) return
    media.currentTime = Math.max(0, Math.min(seconds, isFinite(media.duration) ? media.duration - 0.2 : seconds))
    void media.play().catch(() => undefined)
  }, [])

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
    const timer = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(timer)
  }, [flash])

  // A–B loop: back to A whenever playback passes B.
  useEffect(() => {
    if (!mediaEl) return undefined
    const onTime = (): void => {
      const { a, b } = loopRef.current
      if (a !== null && b !== null && mediaEl.currentTime >= b) mediaEl.currentTime = a
    }
    mediaEl.addEventListener('timeupdate', onTime)
    return () => mediaEl.removeEventListener('timeupdate', onTime)
  }, [mediaEl])

  const onLoaded = (): void => {
    const media = mediaRef.current
    if (!media || !item) return
    media.playbackRate = speed
    media.volume = Math.max(0, Math.min(1, stored('player.volume', 1)))
    const start = queue.startAt
    const previous = progressRef.current[item.key]
    if (start && start.key === item.key && usedStart.current !== start.nonce) {
      usedStart.current = start.nonce
      media.currentTime = start.at
    } else if (settings.resumePlayback && isInProgress(previous) && previous) {
      media.currentTime = previous.position
      setResumedAt(previous.position)
    }
    void media.play().catch(() => undefined)
  }

  const onEnded = (): void => {
    const media = mediaRef.current
    if (media && item && isFinite(media.duration)) void window.api.saveProgress(item.key, media.duration, media.duration)
    const { a, b } = loopRef.current
    if (media && a !== null && b !== null) {
      media.currentTime = a
      void media.play().catch(() => undefined)
      return
    }
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

  const saveMoment = useCallback(async () => {
    const media = mediaRef.current
    if (!media || !item) return
    try {
      const moment = await unwrap(
        window.api.momentAdd({
          key: item.key,
          videoId: item.videoId,
          url: item.videoId ? 'https://www.youtube.com/watch?v=' + item.videoId : null,
          title: item.title ?? item.name,
          channel: item.uploader,
          at: media.currentTime,
          note: '',
        }),
      )
      setFlash('Moment saved at ' + formatDuration(moment.at))
      setSavedTab('moments')
      setFocusMoment(moment.id)
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [item, pushToast, setSavedTab])

  const setLoopPoint = useCallback((which: 'a' | 'b' | 'clear') => {
    const media = mediaRef.current
    if (!media) return
    if (which === 'clear') {
      setLoop({ a: null, b: null })
      setFlash('Loop off')
      return
    }
    const t = media.currentTime
    const prev = loopRef.current
    if (which === 'a') {
      setLoop({ a: t, b: prev.b !== null && prev.b > t + 0.5 ? prev.b : null })
      setFlash('Loop from ' + formatDuration(t) + ' (press ] to close it)')
      return
    }
    // B without an A loops the last 10 seconds.
    const a = prev.a !== null && prev.a < t - 0.5 ? prev.a : Math.max(0, t - 10)
    setLoop({ a, b: t })
    setFlash('Looping ' + formatDuration(a) + '–' + formatDuration(t))
    media.currentTime = a
  }, [])

  // One button for the loop: set A, then B, then off.
  const cycleLoop = (): void => {
    if (loop.a === null) setLoopPoint('a')
    else if (loop.b === null) setLoopPoint('b')
    else setLoopPoint('clear')
  }

  const takeSnapshot = useCallback(async () => {
    const media = mediaRef.current
    if (!media || !item || item.kind !== 'video') return
    if (!ffmpegOk) {
      pushToast('Snapshots need ffmpeg. Install it from the banner or Settings > Tools.', 'info')
      return
    }
    setBusy('snapshot')
    try {
      const file = await unwrap(window.api.snapshot({ absPath: item.absPath, at: media.currentTime, title: item.title ?? item.name }))
      setFlash('Snapshot saved')
      pushToast('Snapshot saved (' + formatBytes(file.size) + ').', 'success', { actions: [{ label: 'Show in folder', onClick: () => void window.api.revealPath(file.path) }] })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }, [item, ffmpegOk, pushToast])

  const exportClip = async (format: ClipFormat): Promise<void> => {
    if (!item || loop.a === null || loop.b === null) return
    setBusy('clip')
    pushToast('Saving the clip…', 'info', { duration: 2500 })
    try {
      const file = await unwrap(window.api.exportClip({ absPath: item.absPath, start: loop.a, end: loop.b, format, title: item.title ?? item.name }))
      pushToast((format === 'gif' ? 'GIF' : format === 'mp3' ? 'Audio clip' : 'Clip') + ' saved to Clips (' + formatBytes(file.size) + ').', 'success', {
        actions: [
          { label: 'Show in folder', onClick: () => void window.api.revealPath(file.path) },
          { label: 'Open', onClick: () => void window.api.openPath(file.path) },
        ],
      })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const copyLinkHere = async (): Promise<void> => {
    const media = mediaRef.current
    if (!item?.videoId || !media) return
    try {
      await navigator.clipboard.writeText('https://youtu.be/' + item.videoId + '?t=' + Math.floor(media.currentTime))
      setFlash('Link to ' + formatDuration(media.currentTime) + ' copied')
    } catch {
      setFlash('Could not copy the link')
    }
  }

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
      else if (key === 't') setSavedTab('transcript')
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
      else if (key === 'b') void saveMoment()
      else if (event.key === '[') setLoopPoint('a')
      else if (event.key === ']') setLoopPoint('b')
      else if (event.key === '\\') setLoopPoint('clear')
      else if (key === 's') void takeSnapshot()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step, queue, showKeys, speed, toggleFullscreen, togglePip, toggleSubtitles, saveMoment, setLoopPoint, takeSnapshot, setSavedTab])

  if (!item) return null
  const favorite = libState.favorites.includes(item.key)
  const nextRepeat: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' }
  const tracks = item.subtitles.map((sub) => <track key={sub.url} kind="subtitles" src={sub.url} srcLang={sub.lang} label={sub.lang.toUpperCase()} />)
  const media =
    item.kind === 'video' ? (
      <video
        key={item.key}
        ref={setMedia}
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
          ref={setMedia}
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
  const transcript = transcripts[item.key]
  const loopLabel = loop.a === null ? 'A–B' : loop.b === null ? 'A ' + formatDuration(loop.a) + ' → B?' : formatDuration(loop.a) + '–' + formatDuration(loop.b)
  const tabLabel: Record<SideTab, ReactNode> = {
    upnext: <><ListVideo size={13} />Up next <span className="count">{queue.items.length}</span></>,
    transcript: <><Captions size={13} />Transcript</>,
    chapters: <><ListOrdered size={13} />Chapters <span className="count">{chapters.length}</span></>,
    moments: <><StickyNote size={13} />Moments {itemMoments.length ? <span className="count">{itemMoments.length}</span> : null}</>,
  }

  return (
    <div className="overlay" onClick={close} role="dialog" aria-modal="true">
      <div className="overlay-inner with-queue" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2 title={item.title ?? item.name}>{item.title ?? item.name}</h2>
            <div className="sub">
              {[item.uploader, item.folder, chapter ? 'Chapter: ' + chapter.title : null, queue.items.length > 1 ? 'item ' + (queue.order[queue.pos] + 1) + ' of ' + queue.items.length : null]
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
            {item.videoId ? (
              <button type="button" className="btn small" onClick={() => void copyLinkHere()} title="Copy a YouTube link to this exact second">
                <Link size={15} />
              </button>
            ) : null}
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
                <span className="chip player-flash">{flash}</span>
              ) : null}
              {sponsor.skipped ? (
                <span className="chip skip-chip">
                  Skipped {SEGMENT_LABELS[sponsor.skipped.category] ?? sponsor.skipped.category}
                  <button type="button" className="link-btn" onClick={sponsor.undo}>Watch it</button>
                </span>
              ) : null}
            </div>
            <Timeline
              duration={duration}
              time={time}
              chapters={chapters}
              segments={sponsorActive ? sponsor.segments : []}
              moments={itemMoments}
              loop={loop}
              onSeek={seek}
            />
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
              <span className="sep" />
              <button type="button" className="btn small" onClick={() => void saveMoment()} title="Save this moment (B)">
                <BookmarkPlus size={15} />
              </button>
              <button type="button" className={'btn small' + (loop.a !== null ? ' on' : '')} onClick={cycleLoop} title="Loop a part: set A, then B, then off ([ and ] keys)">
                <Repeat2 size={15} />
                <span className="loop-label">{loopLabel}</span>
              </button>
              {loop.a !== null && loop.b !== null ? (
                <MoreMenu
                  label="Save this part"
                  className="btn small primary save-part"
                  icon={busy === 'clip' ? <Loader2 size={15} className="spin" /> : <Scissors size={15} />}
                  items={
                    ffmpegOk
                      ? [
                          ...(item.kind === 'video' ? [{ label: 'Video clip (MP4)', icon: <Video size={14} />, onSelect: () => void exportClip('mp4') }] : []),
                          ...(item.kind === 'video' ? [{ label: 'Animated GIF (up to 30 s)', icon: <FileDown size={14} />, onSelect: () => void exportClip('gif') }] : []),
                          { label: 'Audio (MP3)', icon: <Music size={14} />, onSelect: () => void exportClip('mp3') },
                        ]
                      : [{ label: 'Needs ffmpeg: install it in Settings > Tools', icon: <Scissors size={14} />, onSelect: () => undefined }]
                  }
                />
              ) : null}
              {item.kind === 'video' ? (
                <>
                  <button type="button" className="btn small" disabled={busy === 'snapshot'} onClick={() => void takeSnapshot()} title="Snapshot of this frame (S)">
                    {busy === 'snapshot' ? <Loader2 size={15} className="spin" /> : <Camera size={15} />}
                  </button>
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
              {sponsorActive ? <span className="chip soft" title="SponsorBlock: these parts are skipped as they come">{sponsor.segments.length === 1 ? 'Skips 1 sponsor part' : 'Skips ' + sponsor.segments.length + ' sponsor parts'}</span> : null}
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
          <aside className="upnext side-panel">
            <div className="side-tabs" role="tablist">
              {sideTabs.map((id) => (
                <button key={id} type="button" role="tab" aria-selected={side === id} className={side === id ? 'active' : ''} onClick={() => setSavedTab(id)}>
                  {tabLabel[id]}
                </button>
              ))}
            </div>
            {side === 'upnext' ? (
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
            ) : null}
            {side === 'transcript' ? (
              <TranscriptView
                transcript={transcript?.data ?? null}
                loading={!transcript || transcript.loading}
                error={transcript?.error ?? null}
                time={time}
                onSeek={seek}
                emptyHint={item.videoId ? 'This one has no captions on YouTube and no subtitle file, so there is no transcript.' : 'No subtitle file next to this one, so there is no transcript.'}
              />
            ) : null}
            {side === 'chapters' ? (
              <div className="upnext-list">
                {chapters.map((c) => (
                  <button key={c.start} type="button" className={'chapter-row' + (chapter === c ? ' active' : '')} onClick={() => seek(c.start)}>
                    <span className="tline-time">{formatDuration(c.start)}</span>
                    <span>{c.title}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {side === 'moments' ? (
              <div className="side-moments">
                <button type="button" className="btn small primary" onClick={() => void saveMoment()}>
                  <BookmarkPlus size={14} />
                  <span>Save this moment</span>
                  <kbd>B</kbd>
                </button>
                {itemMoments.length ? (
                  <div className="moment-list">
                    {itemMoments.map((m) => (
                      <MomentRow key={m.id} moment={m} onOpen={(x) => seek(x.at)} autoFocus={focusMoment === m.id} active={Math.abs(time - m.at) < 2} />
                    ))}
                  </div>
                ) : (
                  <p className="hint" style={{ lineHeight: 1.55 }}>
                    Bookmark the parts you want to come back to, with a note. They show on the map under the video and in the Moments tab, and export as Markdown.
                  </p>
                )}
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  )
}
