import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, FolderOpen, MonitorPlay, X } from 'lucide-react'
import type { PlayerModel } from '../lib/types'

export default function PlayerOverlay({
  model,
  onClose,
  onPrev,
  onNext,
  onReveal,
  onOpenExternal,
  hasPrev,
  hasNext,
}: {
  model: PlayerModel
  onClose: () => void
  onPrev?: () => void
  onNext?: () => void
  onReveal?: () => void
  onOpenExternal?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}): ReactNode {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight' && hasNext && onNext) onNext()
      if (event.key === 'ArrowLeft' && hasPrev && onPrev) onPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onNext, onPrev, hasNext, hasPrev])

  // Video-only + audio-only DASH streams are played as one unit: the audio element is the clock.
  useEffect(() => {
    if (!model.separateAudio) return undefined
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio) return undefined
    video.muted = true
    const sync = (): void => {
      if (Math.abs(video.currentTime - audio.currentTime) > 0.3) video.currentTime = audio.currentTime
    }
    const onPlay = (): void => {
      video.currentTime = audio.currentTime
      void video.play().catch(() => undefined)
    }
    const onPause = (): void => video.pause()
    const onRate = (): void => {
      video.playbackRate = audio.playbackRate
    }
    const timer = window.setInterval(sync, 900)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('seeked', sync)
    audio.addEventListener('ratechange', onRate)
    return () => {
      window.clearInterval(timer)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('seeked', sync)
      audio.removeEventListener('ratechange', onRate)
      video.pause()
    }
  }, [model.separateAudio, model.videoUrl, model.audioUrl, model.sessionId])

  const dual = model.separateAudio && !!model.videoUrl && !!model.audioUrl

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="overlay-inner" onClick={(event) => event.stopPropagation()}>
        <div className="overlay-head">
          <div style={{ minWidth: 0 }}>
            <h2>{model.title}</h2>
            {model.subtitle ? <div className="sub">{model.subtitle}</div> : null}
          </div>
          <div className="overlay-actions">
            {onPrev ? (
              <button type="button" className="btn small" onClick={onPrev} disabled={!hasPrev} title="Previous (Left arrow)">
                <ChevronLeft size={15} />
              </button>
            ) : null}
            {onNext ? (
              <button type="button" className="btn small" onClick={onNext} disabled={!hasNext} title="Next (Right arrow)">
                <ChevronRight size={15} />
              </button>
            ) : null}
            {onReveal && model.absPath ? (
              <button type="button" className="btn small" onClick={onReveal}>
                <FolderOpen size={15} />
                <span>Show in folder</span>
              </button>
            ) : null}
            {onOpenExternal && model.absPath ? (
              <button type="button" className="btn small" onClick={onOpenExternal}>
                <MonitorPlay size={15} />
                <span>Default player</span>
              </button>
            ) : null}
            <button type="button" className="btn small ghost" onClick={onClose} title="Close (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="overlay-body">
          <div className="video-frame">
            {dual ? (
              <>
                <video ref={videoRef} src={model.videoUrl ?? undefined} playsInline muted />
                <audio ref={audioRef} src={model.audioUrl ?? undefined} controls autoPlay />
              </>
            ) : model.videoUrl ? (
              <video key={model.videoUrl} src={model.videoUrl} controls autoPlay playsInline />
            ) : model.audioUrl ? (
              <audio key={model.audioUrl} src={model.audioUrl} controls autoPlay />
            ) : (
              <div className="empty">No playable source for this item.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
