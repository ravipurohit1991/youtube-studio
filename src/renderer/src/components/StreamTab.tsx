import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ClipboardPaste, Download, Film, Loader2, Music, Play, TriangleAlert, X } from 'lucide-react'
import type { DownloadMode, Settings, StreamSession } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatCount, formatDuration, isYouTubeUrl } from '../lib/format'
import type { StreamDraft, ToastTone } from '../lib/types'
import { EmptyState, LoadingRow } from './common'
import InsightPanel from './InsightPanel'

interface Props {
  settings: Settings
  pushToast: (message: string, tone?: ToastTone) => void
  onDownload: (url: string, mode: DownloadMode) => void
  /** Play this link now (sent from Discover), optionally from a given second. */
  draft: StreamDraft | null
  aiReady: boolean
  onOpenAiSettings: () => void
}

export default function StreamTab({ settings, pushToast, onDownload, draft, aiReady, onOpenAiSettings }: Props): ReactNode {
  const [url, setUrl] = useState('')
  const [session, setSession] = useState<StreamSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState<number | null>(settings.preferredHeight)
  const [audioOnly, setAudioOnly] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pending = useRef<{ time: number; play: boolean } | null>(null)
  const handledDraft = useRef(0)
  // The video the AI panel is about; it survives quality switches (which briefly clear the session).
  const [insightUrl, setInsightUrl] = useState<string | null>(null)

  const load = useCallback(
    async (options?: { target?: string; height?: number | null; audioOnly?: boolean; keepPosition?: boolean }) => {
      const target = (options?.target ?? url).trim()
      if (!target) {
        pushToast('Paste a YouTube link first.', 'error')
        return
      }
      if (!isYouTubeUrl(target)) pushToast('That does not look like a YouTube link, trying anyway...', 'info')
      const nextHeight = options?.height === undefined ? height : options.height
      const nextAudioOnly = options?.audioOnly === undefined ? audioOnly : options.audioOnly
      const current = videoRef.current ?? audioRef.current
      if (options?.keepPosition && current) {
        pending.current = { time: current.currentTime, play: !current.paused }
        current.pause()
      }
      setLoading(true)
      setError(null)
      setSession((previous) => {
        if (previous) void window.api.releaseStream(previous.sessionId)
        return null
      })
      try {
        const resolved = await unwrap(window.api.resolveStream({ url: target, height: nextHeight, audioOnly: nextAudioOnly }))
        setSession(resolved)
        setInsightUrl(resolved.pageUrl)
        setHeight(resolved.height ?? (nextAudioOnly ? null : nextHeight))
        setAudioOnly(resolved.isAudioOnly)
      } catch (err) {
        const message = errorMessage(err)
        setError(message)
        pushToast(message, 'error')
      } finally {
        setLoading(false)
      }
    },
    [url, height, audioOnly, pushToast],
  )

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
    setUrl(draft.url)
    pending.current = draft.startAt ? { time: draft.startAt, play: true } : null
    void load({ target: draft.url })
  }, [draft, load])

  const seek = useCallback((seconds: number) => {
    const media = videoRef.current ?? audioRef.current
    if (!media) return
    media.currentTime = seconds
    void media.play().catch(() => undefined)
    media.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])

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
      setUrl(text.trim())
      await load({ target: text.trim() })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [load, pushToast])

  const qualityValue = audioOnly ? 'audio' : height === null || height === undefined ? 'best' : String(height)

  const onQualityChange = (value: string): void => {
    if (value === 'audio') {
      void load({ audioOnly: true, height: null, keepPosition: true })
      return
    }
    const next = value === 'best' ? null : Number(value)
    void load({ audioOnly: false, height: next, keepPosition: true })
  }

  return (
    <div className="panel-scroll">
      <div className="card">
        <div className="input-row">
          <input
            className="input"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            spellCheck={false}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void load()
            }}
          />
          {url ? (
            <button type="button" className="btn ghost" onClick={() => { setUrl(''); setSession(null); setError(null); setInsightUrl(null) }} title="Clear">
              <X size={16} />
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => void paste()}>
            <ClipboardPaste size={15} />
            <span>Paste</span>
          </button>
          <button type="button" className="btn primary" disabled={loading} onClick={() => void load()}>
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
                if (audioOnly || !session) void load({ audioOnly: false, keepPosition: true })
                else setAudioOnly(false)
              }}
            >
              <Film size={13} />{' '}Video
            </button>
            <button
              type="button"
              className={audioOnly ? 'active' : ''}
              onClick={() => void load({ audioOnly: true, height: null, keepPosition: true })}
            >
              <Music size={13} />{' '}Audio only
            </button>
          </div>
          <select className="select" style={{ width: 168 }} value={qualityValue} disabled={!session || loading} onChange={(event) => onQualityChange(event.target.value)}>
            {audioOnly ? <option value="audio">Audio only</option> : null}
            <option value="best">Best available</option>
            {(session?.heightOptions ?? []).map((option) => (
              <option key={option} value={String(option)}>
                {option + 'p'}
              </option>
            ))}
          </select>
          {session ? (
            <button type="button" className="btn" onClick={() => onDownload(session.pageUrl, audioOnly ? 'audio_only' : 'video_audio')}>
              <Download size={15} />
              <span>{audioOnly ? 'Download audio' : 'Download this'}</span>
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginTop: 16, borderColor: 'rgba(255,97,97,0.4)' }}>
          <div className="card-title" style={{ color: 'var(--err)' }}>
            <TriangleAlert size={16} />
            <span>Could not start playback</span>
          </div>
          <p style={{ margin: 0, color: 'var(--text-dim)', lineHeight: 1.55 }}>{error}</p>
          <div className="row" style={{ marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => void load()}>Try again</button>
          </div>
        </div>
      ) : null}

      {loading ? <LoadingRow label="Asking YouTube for playable streams..." /> : null}

      {session ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="video-frame">
            {separateAudio ? (
              <>
                <video key={session.sessionId} ref={videoRef} src={session.video?.url} controls autoPlay playsInline />
                <audio key={session.sessionId + ':a'} ref={audioRef} src={session.audio?.url} preload="auto" style={{ display: 'none' }} />
              </>
            ) : session.video ? (
              <video key={session.sessionId} ref={videoRef} src={session.video.url} controls autoPlay playsInline />
            ) : session.audio ? (
              <audio key={session.sessionId} ref={audioRef} src={session.audio.url} controls autoPlay />
            ) : null}
          </div>
          <div className="row">
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 650, fontSize: 15 }}>{session.title}</div>
              <div className="row tight" style={{ marginTop: 7 }}>
                {session.uploader ? <span className="chip">{session.uploader}</span> : null}
                <span className="chip">{formatDuration(session.duration)}</span>
                <span className="chip">{session.formatLabel}</span>
                {separateAudio ? <span className="chip">video + audio synced</span> : null}
                <span className="chip ok">ad-free</span>
              </div>
            </div>
            <button
              type="button"
              className="btn small ghost"
              onClick={() => {
                window.open('https://www.youtube.com/watch?v=' + session.videoId, '_blank')
              }}
            >
              Open on YouTube
            </button>
          </div>
        </div>
      ) : null}

      {insightUrl && (session || loading) && !error ? (
        <div style={{ marginTop: 16 }}>
          <InsightPanel url={insightUrl} aiReady={aiReady} onOpenSettings={onOpenAiSettings} pushToast={pushToast} onSeek={seek} />
        </div>
      ) : null}

      {!session && !loading && !error ? (
        <EmptyState
          icon={<Play size={40} />}
          title="Stream any YouTube video here"
          message="Paste a link, hit Play, and the video runs inside the app without ads or overlays. Streams are proxied through a local server so seeking works exactly like a normal player."
        />
      ) : null}
    </div>
  )
}
