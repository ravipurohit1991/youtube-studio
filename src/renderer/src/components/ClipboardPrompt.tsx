import { useEffect, useState, type ReactNode } from 'react'
import { Download, Music, Play, SlidersHorizontal, X } from 'lucide-react'
import { unwrap } from '../lib/api'
import { looksLikeCollection, youTubeId, ytThumb } from '../lib/format'
import { hideBroken } from './common'

interface Props {
  url: string
  onWatch: () => void
  onDownload: (mode: 'video_audio' | 'audio_only') => void
  onOpen: () => void
  onDismiss: () => void
}

/** "You copied a YouTube link": watch or save it without switching tabs. */
export default function ClipboardPrompt({ url, onWatch, onDownload, onOpen, onDismiss }: Props): ReactNode {
  const [title, setTitle] = useState<string | null>(null)
  const collection = looksLikeCollection(url)
  const thumb = ytThumb(youTubeId(url))

  useEffect(() => {
    let alive = true
    setTitle(null)
    // Reading the title also warms the cache, so Watch or Download starts faster.
    if (!collection) void unwrap(window.api.probe(url)).then((meta) => alive && setTitle(meta.title)).catch(() => undefined)
    const timer = window.setTimeout(onDismiss, 20000)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [url, collection, onDismiss])

  return (
    <div className="clip-prompt" role="dialog" aria-label="Copied link">
      {thumb ? <img src={thumb} alt="" onError={hideBroken} /> : null}
      <div className="clip-text">
        <div className="clip-label">{collection ? 'Copied a playlist or channel' : 'Copied a YouTube link'}</div>
        <div className="clip-title" title={url}>{title ?? url.replace(/^https?:\/\/(www\.)?/, '')}</div>
      </div>
      {collection ? (
        <button type="button" className="btn small primary" onClick={onOpen}>
          <SlidersHorizontal size={14} />
          <span>Open</span>
        </button>
      ) : (
        <>
          <button type="button" className="btn small primary" onClick={onWatch}>
            <Play size={14} />
            <span>Watch</span>
          </button>
          <button type="button" className="btn small" onClick={() => onDownload('video_audio')} title="Download the video">
            <Download size={14} />
          </button>
          <button type="button" className="btn small" onClick={() => onDownload('audio_only')} title="Download the audio">
            <Music size={14} />
          </button>
        </>
      )}
      <button type="button" className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  )
}
