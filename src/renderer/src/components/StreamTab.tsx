import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BookmarkPlus,
  Captions,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  Film,
  History,
  ListVideo,
  Loader2,
  Music,
  PictureInPicture2,
  Play,
  RectangleHorizontal,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { DownloadMode, Moment, PlaylistEntry, Settings, StreamSession, Transcript, VideoMeta } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatDuration, isYouTubeUrl, timeAgo, youTubeId, ytThumb } from '../lib/format'
import { SEGMENT_LABELS, useMediaDuration, useMediaTime, useSponsorSkip } from '../lib/media'
import { clearStreamHistory, rememberStream, streamHistory, usePref, type StreamHistoryEntry } from '../lib/prefs'
import type { PushToast, StreamDraft } from '../lib/types'
import { EmptyState, LoadingRow, Switch, hideBroken } from './common'
import InsightPanel from './InsightPanel'
import MomentRow from './MomentRow'
import Timeline from './Timeline'
import TranscriptView from './TranscriptView'

interface Props {
  settings: Settings
  pushToast: PushToast
  onDownload: (url: string, mode: DownloadMode) => void
  onQuickDownload: (url: string, mode: DownloadMode) => Promise<void>
  /** Play this link now (sent from Discover, Home or the palette), optionally from a given second. */
  draft: StreamDraft | null
  aiReady: boolean
  onOpenAiSettings: () => void
  /** The tab is in front (and no player covers it): its keyboard shortcuts are live. */
  active: boolean
  moments: Moment[]
}

/** A YouTube playlist playing in the Stream tab, one video after another. */
interface StreamQueue {
  /** The playlist link. */
  url: string
  title: string
  entries: PlaylistEntry[]
  /** Play order: indexes into entries (shuffled or in playlist order). */
  order: number[]
  /** Position in order of the video playing (or loading). */
  pos: number
}

/** The next video, resolved ahead so it starts the moment the current one ends. */
interface Preloaded {
  url: string
  height: number | null
  audioOnly: boolean
  at: number
  session: Promise<StreamSession | null>
}

// Stream sessions live 3 h on the local server; an older preload is thrown away rather than used.
const PRELOAD_MAX_AGE = 2 * 60 * 60 * 1000
// A queue gives up after this many videos in a row that cannot be played (private, removed, blocked).
const MAX_SKIPS = 5

function shuffled(list: number[]): number[] {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Re-order a queue for shuffle on or off, keeping the current video where it is. */
function arrange(entries: PlaylistEntry[], current: number, shuffle: boolean): { order: number[]; pos: number } {
  const all = entries.map((_, i) => i)
  if (!shuffle) return { order: all, pos: current }
  return { order: [current, ...shuffled(all.filter((i) => i !== current))], pos: 0 }
}

/** Where a playlist link starts: the video in v=, else index=, else the first one (a random one when shuffling). */
function startIndex(link: string, entries: PlaylistEntry[], shuffle: boolean): number {
  const id = youTubeId(link)
  const byId = id ? entries.findIndex((e) => e.id === id) : -1
  if (byId >= 0) return byId
  try {
    const index = Number(new URL(link).searchParams.get('index'))
    if (index >= 1 && index <= entries.length) return index - 1
  } catch {
    /* not a URL */
  }
  return shuffle ? Math.floor(Math.random() * entries.length) : 0
}

export default function StreamTab({ settings, pushToast, onDownload, onQuickDownload, draft, aiReady, onOpenAiSettings, active, moments }: Props): ReactNode {
  const [url, setUrl] = useState('')
  const [session, setSession] = useState<StreamSession | null>(null)
  const [loading, setLoading] = useState<false | 'link' | 'video'>(false)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState<number | null>(settings.preferredHeight)
  const [audioOnly, setAudioOnly] = useState(false)
  const [theater, setTheater] = usePref('stream.theater', false)
  const [history, setHistory] = useState<StreamHistoryEntry[]>(() => streamHistory())
  // Playlist mode: the queue, and playlists the link lists (opened one at a time, never all at once).
  const [queue, setQueue] = useState<StreamQueue | null>(null)
  const [collections, setCollections] = useState<PlaylistEntry[]>([])
  const [autoplay, setAutoplay] = usePref('stream.autoplay', true)
  const [shuffle, setShuffle] = usePref('stream.shuffle', false)
  const [loop, setLoop] = usePref('stream.loop', false)
  const queueRef = useRef<StreamQueue | null>(null)
  queueRef.current = queue
  const queueListRef = useRef<HTMLDivElement | null>(null)
  const preload = useRef<Preloaded | null>(null)
  // Each load takes a ticket; a slower, older one that finishes late is dropped.
  const ticket = useRef(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pending = useRef<{ time: number; play: boolean } | null>(null)
  // The quality asked for ("best" is null). Playlist videos use it, not what the last video happened to have.
  const wantedHeight = useRef<number | null>(settings.preferredHeight)
  const handledDraft = useRef(0)
  // The video the AI panel is about; it survives quality switches (which briefly clear the session).
  const [insightUrl, setInsightUrl] = useState<string | null>(null)
  // The element that keeps time: the video, or the audio when there is no picture.
  const [clock, setClock] = useState<HTMLMediaElement | null>(null)
  const [sideTab, setSideTab] = usePref<'transcript' | 'moments'>('stream.side', 'transcript')
  const [showTranscript, setShowTranscript] = usePref('stream.transcript', false)
  const [transcript, setTranscript] = useState<{ videoId: string; loading: boolean; error: string | null; data: Transcript | null } | null>(null)
  const [focusMoment, setFocusMoment] = useState<string | null>(null)
  const time = useMediaTime(clock)
  const duration = useMediaDuration(clock)
  const sponsor = useSponsorSkip(clock, session?.videoId ?? null, settings.skipSponsorsLive)
  const videoMoments = session ? moments.filter((m) => m.videoId === session.videoId).sort((a, b) => a.at - b.at) : []
  const current = queue ? queue.entries[queue.order[queue.pos]] : null
  const nextPos = queue ? (queue.pos + 1 < queue.order.length ? queue.pos + 1 : loop && queue.order.length > 1 ? 0 : -1) : -1
  const upNext = queue && nextPos >= 0 ? queue.entries[queue.order[nextPos]] : null

  useEffect(() => {
    const refresh = (): void => setHistory(streamHistory())
    window.addEventListener('stream-history', refresh)
    return () => window.removeEventListener('stream-history', refresh)
  }, [])

  const dropPreload = useCallback(() => {
    const ready = preload.current
    preload.current = null
    if (ready) void ready.session.then((s) => s && window.api.releaseStream(s.sessionId))
  }, [])

  /** The preloaded session for this video and quality, if there is one (anything else is released). */
  const takePreload = useCallback(
    (target: string, h: number | null, a: boolean): Promise<StreamSession | null> | null => {
      const ready = preload.current
      if (ready && ready.url === target && ready.height === h && ready.audioOnly === a && Date.now() - ready.at < PRELOAD_MAX_AGE) {
        preload.current = null
        return ready.session
      }
      dropPreload()
      return null
    },
    [dropPreload],
  )

  useEffect(() => dropPreload, [dropPreload])

  /**
   * Stream one video. Throws when it cannot be played; resolves false when a newer load took over.
   * keepSession: leave the current video on screen until the next one is ready (playlist steps).
   */
  const play = useCallback(
    async (target: string, options?: { height?: number | null; audioOnly?: boolean; keepPosition?: boolean; keepSession?: boolean }): Promise<boolean> => {
      const nextHeight = options?.height === undefined ? height : options.height
      if (options?.height !== undefined) wantedHeight.current = options.height
      const nextAudioOnly = options?.audioOnly === undefined ? audioOnly : options.audioOnly
      const media = videoRef.current ?? audioRef.current
      if (options?.keepPosition && media) pending.current = { time: media.currentTime, play: !media.paused }
      media?.pause()
      const mine = ++ticket.current
      setLoading('video')
      setError(null)
      if (!options?.keepSession) setSession(null)
      try {
        const ready = takePreload(target, nextHeight, nextAudioOnly)
        const resolved = (ready ? await ready : null) ?? (await unwrap(window.api.resolveStream({ url: target, height: nextHeight, audioOnly: nextAudioOnly })))
        if (mine !== ticket.current) {
          void window.api.releaseStream(resolved.sessionId)
          return false
        }
        setSession(resolved)
        setInsightUrl(resolved.pageUrl)
        setHeight(resolved.height ?? (nextAudioOnly ? null : nextHeight))
        setAudioOnly(resolved.isAudioOnly)
        rememberStream({ url: resolved.pageUrl, videoId: resolved.videoId, title: resolved.title, uploader: resolved.uploader, duration: resolved.duration })
        return true
      } catch (err) {
        if (mine !== ticket.current) return false
        throw err
      } finally {
        if (mine === ticket.current) setLoading(false)
      }
    },
    [height, audioOnly, takePreload],
  )

  const fail = useCallback(
    (err: unknown) => {
      const message = errorMessage(err)
      setSession(null)
      setError(message)
      pushToast(message, 'error')
    },
    [pushToast],
  )

  /**
   * Play the queue from a position. A video that cannot be played is skipped (in the direction of
   * travel) so a private or removed video never stops the playlist.
   */
  const goTo = useCallback(
    async (pos: number, dir: 1 | -1 = 1, audio?: boolean) => {
      const playlist = queueRef.current?.url
      let at = pos
      let lastError: unknown = null
      for (let tries = 0; tries < MAX_SKIPS; tries++) {
        const q = queueRef.current
        if (!q || q.url !== playlist || at < 0 || at >= q.order.length) break
        const entry = q.entries[q.order[at]]
        const target = at
        setQueue((prev) => (prev && prev.url === q.url ? { ...prev, pos: target } : prev))
        pending.current = null
        try {
          await play(entry.url, { keepSession: true, audioOnly: audio, height: wantedHeight.current })
          return
        } catch (err) {
          lastError = err
          pushToast('Skipped "' + entry.title + '": ' + errorMessage(err), 'error', { duration: 4000 })
          at += dir
        }
      }
      if (lastError) fail(new Error('Could not play the next videos in this playlist. ' + errorMessage(lastError)))
    },
    [play, pushToast, fail],
  )

  /** Open a link: a single video plays; a playlist (or a video inside one) becomes the queue. */
  const open = useCallback(
    async (target: string, options?: { audioOnly?: boolean; startAt?: number; shuffle?: boolean }) => {
      const value = target.trim()
      if (!value) {
        pushToast('Paste a YouTube link first.', 'error')
        return
      }
      if (!isYouTubeUrl(value)) pushToast('That does not look like a YouTube link, trying anyway...', 'info')
      setUrl(value)
      dropPreload()
      const mine = ++ticket.current
      setLoading('link')
      setError(null)
      setCollections([])
      setSession(null)
      let meta: VideoMeta
      try {
        // Cached in the main process, so a single video is not looked up twice.
        meta = await unwrap(window.api.probe(value))
      } catch (err) {
        if (mine === ticket.current) {
          setLoading(false)
          fail(err)
        }
        return
      }
      if (mine !== ticket.current) return
      if (!meta.isPlaylist) {
        setQueue(null)
        pending.current = options?.startAt ? { time: options.startAt, play: true } : null
        try {
          await play(value, { audioOnly: options?.audioOnly })
        } catch (err) {
          fail(err)
        }
        return
      }
      setCollections(meta.collections)
      if (!meta.entries.length) {
        setQueue(null)
        setLoading(false)
        setError(meta.collections.length ? '"' + meta.title + '" lists playlists, not videos. Pick one below to play it.' : '"' + meta.title + '" has no videos that can be played.')
        return
      }
      const wantShuffle = options?.shuffle ?? shuffle
      if (options?.shuffle !== undefined) setShuffle(options.shuffle)
      const next: StreamQueue = { url: meta.url, title: meta.playlistTitle ?? meta.title, entries: meta.entries, ...arrange(meta.entries, startIndex(value, meta.entries, wantShuffle), wantShuffle) }
      queueRef.current = next
      setQueue(next)
      await goTo(next.pos, 1, options?.audioOnly)
    },
    [play, goTo, fail, dropPreload, pushToast, shuffle, setShuffle],
  )

  /** Reload what is playing (quality or audio switch), or open the link in the box. */
  const reload = useCallback(
    async (options: { height?: number | null; audioOnly?: boolean }) => {
      const target = current?.url ?? session?.pageUrl
      if (!target) {
        void open(url, { audioOnly: options.audioOnly })
        return
      }
      try {
        await play(target, { ...options, keepPosition: true })
      } catch (err) {
        fail(err)
      }
    },
    [current?.url, session?.pageUrl, url, open, play, fail],
  )

  const step = useCallback(
    (dir: 1 | -1) => {
      const q = queueRef.current
      if (!q) return
      const media = videoRef.current ?? audioRef.current
      // Like a music player: Previous restarts the video unless it just began.
      if (dir === -1 && media && media.currentTime > 4) {
        media.currentTime = 0
        void media.play().catch(() => undefined)
        return
      }
      let pos = q.pos + dir
      if (pos >= q.order.length) pos = loop ? 0 : -1
      if (pos < 0) return
      void goTo(pos, dir)
    },
    [goTo, loop],
  )

  const closeQueue = useCallback(() => {
    dropPreload()
    setQueue(null)
    setCollections([])
  }, [dropPreload])

  const toggleShuffle = (): void => {
    const next = !shuffle
    setShuffle(next)
    dropPreload()
    setQueue((prev) => (prev ? { ...prev, ...arrange(prev.entries, prev.order[prev.pos], next) } : prev))
  }

  useEffect(() => {
    if (!session) return undefined
    const restore = pending.current
    if (!restore) return undefined
    pending.current = null
    const target = videoRef.current ?? audioRef.current
    if (!target) return undefined
    const apply = (): void => {
      try {
        target.currentTime = restore.time
      } catch {
        /* seeking before metadata is best effort */
      }
      if (restore.play) void target.play().catch(() => undefined)
    }
    if (target.readyState >= 1) apply()
    else target.addEventListener('loadedmetadata', apply, { once: true })
    return undefined
  }, [session?.sessionId])

  useEffect(() => {
    if (!draft || handledDraft.current === draft.nonce) return
    handledDraft.current = draft.nonce
    void open(draft.url, { audioOnly: !!draft.audioOnly, startAt: draft.startAt, shuffle: draft.shuffle })
  }, [draft, open])

  useEffect(() => {
    setClock(session ? videoRef.current ?? audioRef.current : null)
  }, [session?.sessionId])

  // The transcript of the video playing (read once per video, when the transcript is shown).
  useEffect(() => {
    if (!session || !showTranscript || sideTab !== 'transcript' || transcript?.videoId === session.videoId) return
    const videoId = session.videoId
    setTranscript({ videoId, loading: true, error: null, data: null })
    void unwrap(window.api.transcriptForUrl(session.pageUrl))
      .then((data) => setTranscript((prev) => (prev?.videoId === videoId ? { videoId, loading: false, error: null, data } : prev)))
      .catch((err) => setTranscript((prev) => (prev?.videoId === videoId ? { videoId, loading: false, error: 'Could not read the captions: ' + errorMessage(err), data: null } : prev)))
  }, [session, showTranscript, sideTab, transcript?.videoId])

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current ?? audioRef.current
    if (!media) return
    media.currentTime = seconds
    void media.play().catch(() => undefined)
    media.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

  const saveMoment = useCallback(async () => {
    const media = videoRef.current ?? audioRef.current
    if (!media || !session) return
    try {
      const moment = await unwrap(
        window.api.momentAdd({
          key: null,
          videoId: session.videoId,
          url: 'https://www.youtube.com/watch?v=' + session.videoId,
          title: session.title,
          channel: session.uploader,
          at: media.currentTime,
          note: '',
        }),
      )
      setShowTranscript(true)
      setSideTab('moments')
      setFocusMoment(moment.id)
      pushToast('Moment saved at ' + formatDuration(moment.at) + '. Add a note if you like.', 'success', { duration: 2600 })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [session, pushToast, setShowTranscript, setSideTab])

  // While the Stream tab is in front: B saves a moment, Shift+N / Shift+P step through a playlist.
  useEffect(() => {
    if (!active || !session) return undefined
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault()
        void saveMoment()
      } else if (event.shiftKey && (key === 'n' || key === 'p') && queueRef.current) {
        event.preventDefault()
        step(key === 'n' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, session, saveMoment, step])

  // Playlist mode: when a video ends, the next one starts (also while you are on another tab).
  useEffect(() => {
    if (!clock) return undefined
    const onEnded = (): void => {
      const q = queueRef.current
      if (!q || !autoplay) return
      if (q.pos + 1 < q.order.length) void goTo(q.pos + 1)
      else if (loop && q.order.length > 1) void goTo(0)
      else pushToast('End of "' + q.title + '".', 'info')
    }
    clock.addEventListener('ended', onEnded)
    return () => clock.removeEventListener('ended', onEnded)
  }, [clock, autoplay, loop, goTo, pushToast])

  // Resolve the next video a few seconds into this one, so it starts right away when this one ends.
  const upNextUrl = autoplay ? upNext?.url ?? null : null
  useEffect(() => {
    if (!session || !upNextUrl || loading) return undefined
    const h = wantedHeight.current
    const a = audioOnly
    const timer = window.setTimeout(() => {
      const ready = preload.current
      if (ready && ready.url === upNextUrl && ready.height === h && ready.audioOnly === a) return
      dropPreload()
      preload.current = {
        url: upNextUrl,
        height: h,
        audioOnly: a,
        at: Date.now(),
        session: unwrap(window.api.resolveStream({ url: upNextUrl, height: h, audioOnly: a })).catch(() => null),
      }
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [session?.sessionId, upNextUrl, height, audioOnly, loading, dropPreload])

  const queueTitle = queue?.title ?? null
  // Media keys and the system media controls: play/pause come for free, next/previous step the playlist.
  useEffect(() => {
    if (!session || !('mediaSession' in navigator)) return undefined
    const ms = navigator.mediaSession
    try {
      ms.metadata = new MediaMetadata({
        title: session.title,
        artist: session.uploader ?? '',
        album: queueTitle ?? '',
        artwork: session.thumbnailUrl ? [{ src: session.thumbnailUrl }] : [],
      })
    } catch {
      /* metadata is cosmetic */
    }
    const hasQueue = queueTitle !== null
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* not supported here */
      }
    }
    set('nexttrack', hasQueue ? () => step(1) : null)
    set('previoustrack', hasQueue ? () => step(-1) : null)
    return () => {
      set('nexttrack', null)
      set('previoustrack', null)
    }
  }, [session, queueTitle, step])

  // Keep the playing video visible in the queue list (scrolls the list only, never the page).
  useEffect(() => {
    const list = queueListRef.current
    const item = list?.querySelector<HTMLElement>('.upnext-item.active')
    if (!list || !item) return
    const top = item.offsetTop - list.offsetTop
    if (top < list.scrollTop || top + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = Math.max(0, top - list.clientHeight / 3)
  }, [queue?.pos, queue?.order])

  const separateAudio = !!session?.separateAudio && !!session.video && !!session.audio

  // High resolutions come as a silent video stream plus a separate audio stream. The visible
  // <video> (with the native controls) is the clock; the hidden <audio> follows it.
  useEffect(() => {
    if (!separateAudio) return undefined
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio) return undefined
    const align = (): void => {
      if (Math.abs(audio.currentTime - video.currentTime) > 0.3) audio.currentTime = video.currentTime
    }
    const onPlay = (): void => {
      align()
      void audio.play().catch(() => undefined)
    }
    const onPause = (): void => audio.pause()
    const onSeeked = (): void => {
      audio.currentTime = video.currentTime
    }
    const onRate = (): void => {
      audio.playbackRate = video.playbackRate
    }
    const onVolume = (): void => {
      audio.volume = video.volume
      audio.muted = video.muted
    }
    const timer = window.setInterval(() => {
      if (!video.paused) align()
    }, 900)
    video.addEventListener('play', onPlay)
    video.addEventListener('playing', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onPause)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('ratechange', onRate)
    video.addEventListener('volumechange', onVolume)
    onVolume()
    if (!video.paused) onPlay()
    return () => {
      window.clearInterval(timer)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('playing', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onPause)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('ratechange', onRate)
      video.removeEventListener('volumechange', onVolume)
      audio.pause()
    }
  }, [separateAudio, session?.sessionId])

  useEffect(() => {
    return () => {
      if (session) void window.api.releaseStream(session.sessionId)
    }
  }, [session?.sessionId])

  const paste = useCallback(async () => {
    try {
      const text = await unwrap(window.api.readClipboard())
      if (!text.trim()) {
        pushToast('Clipboard is empty.', 'info')
        return
      }
      await open(text.trim())
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [open, pushToast])

  const togglePip = async (): Promise<void> => {
    const video = videoRef.current
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch {
      pushToast('Picture-in-picture is not available for this stream.', 'info')
    }
  }

  const copyLink = async (): Promise<void> => {
    if (!session) return
    try {
      await navigator.clipboard.writeText('https://www.youtube.com/watch?v=' + session.videoId)
      pushToast('Link copied.', 'success')
    } catch {
      pushToast('Could not copy the link.', 'error')
    }
  }

  const qualityValue = audioOnly ? 'audio' : height === null || height === undefined ? 'best' : String(height)

  const onQualityChange = (value: string): void => {
    if (value === 'audio') {
      void reload({ audioOnly: true, height: null })
      return
    }
    const next = value === 'best' ? null : Number(value)
    void reload({ audioOnly: false, height: next })
  }

  // Playlists the link lists (a channel's other tabs, a page of playlists): each opens on its own.
  const collectionList = (
    <div className="stack" style={{ gap: 8 }}>
      <div className="section-label">{queue ? 'Also in this link' : 'Playlists in this link'}</div>
      <div className="row tight">
        {collections.map((c) => (
          <button key={c.url} type="button" className="btn small" onClick={() => void open(c.url)} title={c.url}>
            <ListVideo size={14} />
            <span>{c.title}</span>
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="panel-scroll">
      <div className={theater ? 'theater' : 'panel-narrow'}>
        <div className="card">
          <div className="input-row">
            <input
              className="input"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void open(url)
              }}
            />
            {url ? (
              <button type="button" className="btn ghost" onClick={() => { ticket.current++; setUrl(''); setSession(null); setError(null); setInsightUrl(null); setLoading(false); closeQueue() }} title="Clear">
                <X size={16} />
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => void paste()}>
              <ClipboardPaste size={15} />
              <span>Paste</span>
            </button>
            <button type="button" className="btn primary" disabled={!!loading} onClick={() => void open(url)}>
              {loading ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
              <span>{loading ? 'Loading' : 'Play'}</span>
            </button>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <div className="segmented">
              <button
                type="button"
                className={!audioOnly ? 'active' : ''}
                onClick={() => {
                  if (audioOnly || !session) void reload({ audioOnly: false })
                  else setAudioOnly(false)
                }}
              >
                <Film size={13} />Video
              </button>
              <button
                type="button"
                className={audioOnly ? 'active' : ''}
                onClick={() => void reload({ audioOnly: true, height: null })}
              >
                <Music size={13} />Audio only
              </button>
            </div>
            <select className="select" style={{ width: 168 }} value={qualityValue} disabled={!session || !!loading} onChange={(event) => onQualityChange(event.target.value)}>
              {audioOnly ? <option value="audio">Audio only</option> : null}
              <option value="best">Best available</option>
              {(session?.heightOptions ?? []).map((option) => (
                <option key={option} value={String(option)}>
                  {option + 'p'}
                </option>
              ))}
            </select>
            {session ? (
              <div className="row tight spacer">
                <button type="button" className="btn primary" onClick={() => void onQuickDownload(session.pageUrl, 'video_audio')} title="Download the video with your default quality">
                  <Download size={15} />
                  <span>Save video</span>
                </button>
                <button type="button" className="btn" onClick={() => void onQuickDownload(session.pageUrl, 'audio_only')} title={'Download the audio as ' + settings.audioFormat.toUpperCase()}>
                  <Music size={15} />
                  <span>Save audio</span>
                </button>
                <button type="button" className="btn ghost" onClick={() => onDownload(session.pageUrl, audioOnly ? 'audio_only' : 'video_audio')} title="Quality, clip, SponsorBlock and more">
                  <SlidersHorizontal size={15} />
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="card" style={{ marginTop: 16, borderColor: 'rgba(255,99,99,0.4)' }}>
            <div className="card-title" style={{ color: 'var(--err)' }}>
              <TriangleAlert size={16} />
              <span>Could not start playback</span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-dim)', lineHeight: 1.55 }}>{error}</p>
            <div className="row" style={{ marginTop: 14 }}>
              {queue ? (
                <button type="button" className="btn" onClick={() => void goTo(queue.pos)}>Try again</button>
              ) : !collections.length ? (
                <button type="button" className="btn" onClick={() => void open(url)}>Try again</button>
              ) : null}
            </div>
          </div>
        ) : null}

        {collections.length && !queue && !loading ? <div style={{ marginTop: 16 }}>{collectionList}</div> : null}

        {loading && !session ? <LoadingRow label={loading === 'link' ? 'Reading the link...' : 'Asking YouTube for playable streams...'} /> : null}

        {session ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="video-frame">
              {separateAudio ? (
                <>
                  <video key="video" ref={videoRef} src={session.video?.url} controls autoPlay playsInline />
                  <audio key="audio" ref={audioRef} src={session.audio?.url} preload="auto" style={{ display: 'none' }} />
                </>
              ) : session.video ? (
                <video key="video" ref={videoRef} src={session.video.url} controls autoPlay playsInline />
              ) : session.audio ? (
                <div className="audio-stage">
                  {session.thumbnailUrl ? <img src={session.thumbnailUrl} alt="" onError={hideBroken} /> : <Music size={64} />}
                  <audio key="audio" ref={audioRef} src={session.audio.url} controls autoPlay />
                </div>
              ) : null}
              {loading && current ? (
                <span className="chip player-flash"><Loader2 size={13} className="spin" /> {current.title}</span>
              ) : null}
              {sponsor.skipped ? (
                <span className="chip skip-chip">
                  Skipped {SEGMENT_LABELS[sponsor.skipped.category] ?? sponsor.skipped.category}
                  <button type="button" className="link-btn" onClick={sponsor.undo}>Watch it</button>
                </span>
              ) : null}
            </div>
            <Timeline duration={duration} time={time} segments={sponsor.segments} moments={videoMoments} onSeek={seek} />
            <div className="stream-info">
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2>{session.title}</h2>
                <div className="row tight">
                  {session.uploader ? <span className="chip">{session.uploader}</span> : null}
                  <span className="chip">{formatDuration(session.duration)}</span>
                  <span className="chip">{session.formatLabel}</span>
                  {separateAudio ? <span className="chip">video + audio synced</span> : null}
                  {queue ? <span className="chip soft"><ListVideo size={12} /> {queue.pos + 1} of {queue.order.length}</span> : null}
                  <span className="chip ok">ad-free</span>
                  {sponsor.segments.length ? <span className="chip ok" title="SponsorBlock: these parts are skipped as they come">{sponsor.segments.length === 1 ? 'Skips 1 sponsor part' : 'Skips ' + sponsor.segments.length + ' sponsor parts'}</span> : null}
                </div>
              </div>
              <div className="row tight nowrap">
                {queue ? (
                  <>
                    <button type="button" className="btn small" onClick={() => step(-1)} disabled={queue.pos === 0 && time <= 4} title="Previous (Shift+P)">
                      <SkipBack size={15} />
                    </button>
                    <button type="button" className="btn small" onClick={() => step(1)} disabled={nextPos < 0} title={upNext ? 'Next: ' + upNext.title + ' (Shift+N)' : 'Next (Shift+N)'}>
                      <SkipForward size={15} />
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn small" onClick={() => void saveMoment()} title="Save this moment (B)">
                  <BookmarkPlus size={15} />
                  <span>Save moment</span>
                </button>
                {session.video ? (
                  <>
                    <button type="button" className="btn small ghost" onClick={() => void togglePip()} title="Picture-in-picture">
                      <PictureInPicture2 size={15} />
                    </button>
                    <button type="button" className={'btn small ghost' + (theater ? ' on' : '')} onClick={() => setTheater(!theater)} title="Theater mode">
                      <RectangleHorizontal size={15} />
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn small ghost" onClick={() => void copyLink()} title="Copy link">
                  <Copy size={15} />
                </button>
                <button type="button" className="btn small ghost" onClick={() => window.open('https://www.youtube.com/watch?v=' + session.videoId, '_blank')} title="Open on YouTube">
                  <ExternalLink size={15} />
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {queue && (session || loading || error) ? (
          <div className="card stream-queue" style={{ marginTop: 16 }}>
            <div className="card-title">
              <ListVideo size={16} />
              <span className="stream-queue-title" title={queue.title}>{queue.title}</span>
              <span className="hint" style={{ fontWeight: 400 }}>{queue.pos + 1} / {queue.order.length}</span>
              <div className="row tight nowrap" style={{ marginLeft: 'auto' }}>
                <button type="button" className="btn small" onClick={() => step(-1)} disabled={queue.pos === 0 && time <= 4} title="Previous (Shift+P)">
                  <SkipBack size={15} />
                </button>
                <button type="button" className="btn small" onClick={() => step(1)} disabled={nextPos < 0} title="Next (Shift+N)">
                  <SkipForward size={15} />
                </button>
                <button type="button" className={'btn small' + (shuffle ? ' on' : '')} onClick={toggleShuffle} title={shuffle ? 'Shuffle: on' : 'Shuffle: off'}>
                  <Shuffle size={15} />
                </button>
                <button type="button" className={'btn small' + (loop ? ' on' : '')} onClick={() => setLoop(!loop)} title={loop ? 'Repeat the playlist: on' : 'Repeat the playlist: off'}>
                  <Repeat size={15} />
                </button>
                <button type="button" className="btn small ghost" onClick={() => onDownload(queue.url, audioOnly ? 'audio_only' : 'video_audio')} title="Download videos from this playlist">
                  <Download size={15} />
                </button>
                <button type="button" className="btn small ghost" onClick={closeQueue} title="Stop playlist mode (this video keeps playing)">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="row" style={{ marginBottom: 8 }}>
              <Switch checked={autoplay} onChange={setAutoplay} label="Autoplay the next video" />
              {autoplay && upNext ? <span className="hint stream-upnext">Up next: {upNext.title}</span> : null}
            </div>
            <div className="upnext-list" ref={queueListRef}>
              {queue.order.map((index, pos) => {
                const entry = queue.entries[index]
                const thumb = entry.thumbnail ?? ytThumb(entry.id)
                return (
                  <button key={entry.id + ':' + pos} type="button" className={'upnext-item' + (pos === queue.pos ? ' active' : '')} onClick={() => void goTo(pos)} title={entry.title}>
                    <span className="upnext-index">{pos === queue.pos ? <Play size={11} fill="currentColor" /> : pos + 1}</span>
                    <span className="upnext-thumb">
                      {thumb ? <img src={thumb} alt="" loading="lazy" onError={hideBroken} /> : <Film size={16} />}
                    </span>
                    <span className="upnext-text">
                      <span className="upnext-name">{entry.title}</span>
                      <span className="upnext-meta">{[entry.uploader, entry.duration ? formatDuration(entry.duration) : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {collections.length ? <div style={{ marginTop: 12 }}>{collectionList}</div> : null}
          </div>
        ) : null}

        {session ? (
          <div className="card stream-side" style={{ marginTop: 16 }}>
            <div className="card-title" style={{ marginBottom: showTranscript ? 12 : 0 }}>
              <div className="segmented">
                <button type="button" className={showTranscript && sideTab === 'transcript' ? 'active' : ''} onClick={() => { setShowTranscript(!(showTranscript && sideTab === 'transcript')); setSideTab('transcript') }}>
                  <Captions size={13} />Transcript
                </button>
                <button type="button" className={showTranscript && sideTab === 'moments' ? 'active' : ''} onClick={() => { setShowTranscript(!(showTranscript && sideTab === 'moments')); setSideTab('moments') }}>
                  <StickyNote size={13} />Moments{videoMoments.length ? ' · ' + videoMoments.length : ''}
                </button>
              </div>
              <span className="hint" style={{ fontWeight: 400 }}>
                {showTranscript ? (sideTab === 'transcript' ? 'Follows the video. Click a line to jump there.' : 'Your bookmarks in this video.') : 'Read along, search what is said, or bookmark moments (B).'}
              </span>
            </div>
            {showTranscript && sideTab === 'transcript' ? (
              <TranscriptView
                transcript={transcript?.videoId === session.videoId ? transcript.data : null}
                loading={!transcript || transcript.videoId !== session.videoId || transcript.loading}
                error={transcript?.videoId === session.videoId ? transcript.error : null}
                time={time}
                onSeek={seek}
                maxHeight={360}
              />
            ) : null}
            {showTranscript && sideTab === 'moments' ? (
              videoMoments.length ? (
                <div className="moment-list">
                  {videoMoments.map((m) => (
                    <MomentRow key={m.id} moment={m} onOpen={(x) => seek(x.at)} autoFocus={focusMoment === m.id} onAutoFocused={() => setFocusMoment(null)} active={Math.abs(time - m.at) < 2} />
                  ))}
                </div>
              ) : (
                <p className="hint" style={{ margin: 0 }}>No moments yet. Press <kbd>B</kbd> or <strong>Save moment</strong> while it plays.</p>
              )
            ) : null}
          </div>
        ) : null}

        {insightUrl && (session || loading) && !error ? (
          <div style={{ marginTop: 16 }}>
            <InsightPanel url={insightUrl} aiReady={aiReady} onOpenSettings={onOpenAiSettings} pushToast={pushToast} onSeek={seek} />
          </div>
        ) : null}

        {!session && !loading && !error ? (
          history.length ? (
            <div style={{ marginTop: 20 }}>
              <div className="shelf-head">
                <History size={16} style={{ color: 'var(--accent)' }} />
                <span className="shelf-title">Recently streamed</span>
                <button type="button" className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={clearStreamHistory}>
                  <Trash2 size={14} />
                  <span>Clear history</span>
                </button>
              </div>
              <div className="recent-grid">
                {history.map((entry) => (
                  <button
                    key={entry.videoId}
                    type="button"
                    className="mini-card"
                    style={{ width: 'auto' }}
                    onClick={() => void open(entry.url)}
                    title={entry.title}
                  >
                    <div className="thumb">
                      {ytThumb(entry.videoId) ? <img src={ytThumb(entry.videoId) as string} alt="" loading="lazy" onError={hideBroken} /> : null}
                      {entry.duration ? <span className="duration">{formatDuration(entry.duration)}</span> : null}
                    </div>
                    <span className="mini-name">{entry.title}</span>
                    <span className="mini-meta">{[entry.uploader, timeAgo(entry.at)].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<Play size={34} />}
              title="Stream any YouTube video here"
              message="Paste a link, hit Play, and the video runs inside the app without ads or overlays. Streams are proxied through a local server so seeking works exactly like a normal player."
            />
          )
        ) : null}
      </div>
    </div>
  )
}
