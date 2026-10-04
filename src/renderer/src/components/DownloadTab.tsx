import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ClipboardPaste,
  Download,
  FolderOpen,
  Info,
  Layers,
  ListVideo,
  Loader2,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { DownloadJob, DownloadMode, DownloadRequest, LibraryItem, Settings, VideoMeta } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatCount, formatDuration, timeAgo } from '../lib/format'
import type { DownloadDraft, ToastTone } from '../lib/types'
import { EmptyState, LoadingRow, ProgressBar } from './common'

interface Props {
  settings: Settings
  jobs: DownloadJob[]
  pushToast: (message: string, tone?: ToastTone) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
  ytdlpReady: boolean
  ffmpegOk: boolean
  ffmpegBusy: boolean
  onInstallFfmpeg: () => Promise<void>
  draft: DownloadDraft | null
}

const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac'] as const

export default function DownloadTab({ settings, jobs, pushToast, onSettingsChange, ytdlpReady, ffmpegOk, ffmpegBusy, onInstallFfmpeg, draft }: Props): ReactNode {
  const [url, setUrl] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<DownloadMode>(settings.defaultMode)
  const [height, setHeight] = useState<number>(settings.preferredHeight)
  const [audioFormat, setAudioFormat] = useState(settings.audioFormat)
  const [writeSubs, setWriteSubs] = useState(settings.writeSubtitles)
  const [subLangs, setSubLangs] = useState(settings.subtitleLanguages)
  const [writeThumbs, setWriteThumbs] = useState(settings.writeThumbnails)
  const [writeInfo, setWriteInfo] = useState(settings.writeMetadata)
  const [queueFilter, setQueueFilter] = useState<'active' | 'history'>('active')
  const seeded = useRef(false)
  const handledDraft = useRef(0)

  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    setMode(settings.defaultMode)
    setHeight(settings.preferredHeight)
    setAudioFormat(settings.audioFormat)
    setWriteSubs(settings.writeSubtitles)
    setSubLangs(settings.subtitleLanguages)
    setWriteThumbs(settings.writeThumbnails)
    setWriteInfo(settings.writeMetadata)
  }, [settings])

  const analyze = useCallback(
    async (target?: string) => {
      const value = (target ?? url).trim()
      if (!value) {
        pushToast('Paste a YouTube link first.', 'error')
        return
      }
      setAnalyzing(true)
      setMeta(null)
      try {
        const result = await unwrap(window.api.probe(value))
        setMeta(result)
        if (result.isPlaylist) {
          const ids = result.entries.map((entry) => entry.id)
          setSelected(new Set(ids.length <= 25 ? ids : ids.slice(0, 10)))
          pushToast('Playlist detected: ' + result.entryCount + ' videos.', 'info')
        } else {
          setSelected(new Set())
          setUrl(result.url)
        }
      } catch (err) {
        const message = errorMessage(err)
        pushToast(message, 'error')
      } finally {
        setAnalyzing(false)
      }
    },
    [url, pushToast],
  )

  useEffect(() => {
    if (!draft) return
    if (handledDraft.current === draft.nonce) return
    handledDraft.current = draft.nonce
    setBatchMode(false)
    setUrl(draft.url)
    setMode(draft.mode)
    void analyze(draft.url)
  }, [draft, analyze])

  const buildRequest = useCallback(
    (targetUrl: string, extra: Partial<DownloadRequest>): DownloadRequest => ({
      url: targetUrl,
      mode,
      height: mode === 'audio_only' ? null : height,
      audioFormat,
      audioQuality: settings.audioQuality,
      writeSubtitles: writeSubs,
      subtitleLanguages: subLangs,
      writeThumbnails: writeThumbs,
      writeMetadata: writeInfo,
      ...extra,
    }),
    [mode, height, audioFormat, settings.audioQuality, writeSubs, subLangs, writeThumbs, writeInfo],
  )

  const startBatch = useCallback(async () => {
    const lines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (!lines.length) {
      pushToast('Add at least one link.', 'error')
      return
    }
    try {
      const requests = lines.map((line) => buildRequest(line, { title: 'Queued link' }))
      await unwrap(window.api.createJobs(requests))
      setBatchText('')
      setQueueFilter('active')
      pushToast(requests.length + ' download(s) queued.', 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [batchText, buildRequest, pushToast])

  const startSingle = useCallback(async () => {
    if (!meta) return
    try {
      let requests: DownloadRequest[]
      if (meta.isPlaylist) {
        const chosen = meta.entries.filter((entry) => selected.has(entry.id))
        if (!chosen.length) {
          pushToast('Pick at least one video from the playlist.', 'error')
          return
        }
        requests = chosen.map((entry) =>
          buildRequest(entry.url, {
            videoId: entry.id,
            title: entry.title,
            uploader: entry.uploader,
            thumbnail: entry.thumbnail,
            duration: entry.duration,
          }),
        )
      } else {
        requests = [
          buildRequest(meta.url, {
            videoId: meta.id,
            title: meta.title,
            uploader: meta.uploader,
            thumbnail: meta.thumbnail,
            duration: meta.duration,
          }),
        ]
      }
      await unwrap(window.api.createJobs(requests))
      setQueueFilter('active')
      pushToast(requests.length + ' download(s) queued.', 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [meta, selected, buildRequest, pushToast])

  const cancelJob = useCallback(async (id: string) => {
    try {
      await unwrap(window.api.cancelJob(id))
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [pushToast])

  const retryJob = useCallback(async (id: string) => {
    try {
      await unwrap(window.api.retryJob(id))
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [pushToast])

  const removeJob = useCallback(async (id: string) => {
    try {
      await unwrap(window.api.removeJob(id))
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [pushToast])

  const clearFinished = useCallback(async () => {
    try {
      await unwrap(window.api.clearFinishedJobs())
      pushToast('Finished downloads cleared.', 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [pushToast])

  const visibleJobs = useMemo(() => {
    if (queueFilter === 'active') {
      return jobs.filter((job) => job.status === 'downloading' || job.status === 'processing' || job.status === 'queued')
    }
    return jobs.filter((job) => job.status === 'completed' || job.status === 'error' || job.status === 'canceled')
  }, [jobs, queueFilter])

  const activeCount = jobs.filter((job) => job.status === 'downloading' || job.status === 'processing').length
  const finishedCount = jobs.filter((job) => job.status === 'completed' || job.status === 'error' || job.status === 'canceled').length

  return (
    <div className="panel-scroll">
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="segmented">
            <button type="button" className={!batchMode ? 'active' : ''} onClick={() => setBatchMode(false)}>Single link</button>
            <button type="button" className={batchMode ? 'active' : ''} onClick={() => setBatchMode(true)}>Batch mode</button>
          </div>
          <span className="hint">Destination: <span className="mono">{settings.downloadsDir}</span></span>
        </div>

        {batchMode ? (
          <>
            <textarea
              className="textarea"
              placeholder={'One YouTube link per line\nhttps://youtu.be/...\nhttps://www.youtube.com/watch?v=...'}
              value={batchText}
              spellCheck={false}
              onChange={(event) => setBatchText(event.target.value)}
            />
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="btn primary" onClick={() => void startBatch()} disabled={!ytdlpReady}>
                <Download size={15} />
                <span>Queue all links</span>
              </button>
              <span className="hint">Each line becomes its own download using the options below.</span>
            </div>
          </>
        ) : (
          <>
            <div className="input-row">
              <input
                className="input"
                placeholder="https://www.youtube.com/watch?v=... or a playlist link"
                value={url}
                spellCheck={false}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void analyze()
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void (async () => {
                    try {
                      const text = await unwrap(window.api.readClipboard())
                      if (text.trim()) setUrl(text.trim())
                      else pushToast('Clipboard is empty.', 'info')
                    } catch (err) {
                      pushToast(errorMessage(err), 'error')
                    }
                  })()
                }}
              >
                <ClipboardPaste size={15} />
                <span>Paste</span>
              </button>
              <button type="button" className="btn primary" onClick={() => void analyze()} disabled={analyzing || !ytdlpReady}>
                {analyzing ? <Loader2 size={15} /> : <Search size={15} />}
                <span>{analyzing ? 'Reading' : 'Analyze'}</span>
              </button>
            </div>
          </>
        )}
      </div>

      {analyzing ? <LoadingRow label="Reading title, formats and resolutions..." /> : null}

      {meta && !analyzing ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="preview">
            <div className="thumb">
              {meta.thumbnail ? <img src={meta.thumbnail} alt="" /> : <div className="placeholder">no thumbnail</div>}
              {meta.duration ? <span className="duration">{formatDuration(meta.duration)}</span> : null}
            </div>
            <div>
              <h2>{meta.title}</h2>
              <div className="preview-meta">
                {meta.uploader ? <span className="chip">{meta.uploader}</span> : null}
                {meta.isPlaylist ? <span className="chip accent"><Layers size={12} /> playlist · {meta.entryCount}</span> : null}
                {meta.isLive ? <span className="chip warn">live</span> : null}
                {meta.viewCount ? <span className="chip">{formatCount(meta.viewCount)} views</span> : null}
                {meta.extractor ? <span className="chip">{meta.extractor}</span> : null}
              </div>
              {meta.isPlaylist ? (
                <div>
                  <div className="row tight" style={{ marginBottom: 8 }}>
                    <button type="button" className="btn small" onClick={() => setSelected(new Set(meta.entries.map((entry) => entry.id)))}>Select all</button>
                    <button type="button" className="btn small" onClick={() => setSelected(new Set())}>Select none</button>
                    <span className="stat">{selected.size} of {meta.entryCount} selected</span>
                  </div>
                  <div className="scroll-y">
                    {meta.entries.map((entry, index) => (
                      <label key={entry.id} className="entry-row">
                        <input
                          type="checkbox"
                          checked={selected.has(entry.id)}
                          onChange={(event) => {
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (event.target.checked) next.add(entry.id)
                              else next.delete(entry.id)
                              return next
                            })
                          }}
                        />
                        <span className="idx">{index + 1}</span>
                        <span className="label">{entry.title}</span>
                        <span className="stat">{entry.duration ? formatDuration(entry.duration) : ''}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="divider" />

          <div className="card-title"><Info size={15} /><span>What to download</span></div>
          <div className="segmented" style={{ marginBottom: 14 }}>
            <button type="button" className={mode === 'video_audio' ? 'active' : ''} onClick={() => setMode('video_audio')}>Video (with audio)</button>
            <button type="button" className={mode === 'audio_only' ? 'active' : ''} onClick={() => setMode('audio_only')}>Audio only</button>
          </div>

          <div className="grid-3">
            {mode !== 'audio_only' ? (
              <>
                <div className="field">
                  <label htmlFor="dl-height">Resolution</label>
                  <select id="dl-height" className="select" value={String(height)} onChange={(event) => setHeight(Number(event.target.value))}>
                    <option value="0">Best available</option>
                    {(meta.heights.length ? meta.heights : [1080, 720, 480, 360]).map((option) => (
                      <option key={option} value={String(option)}>{option + 'p'}</option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="dl-audio">Audio format</label>
                  <select id="dl-audio" className="select" value={audioFormat} onChange={(event) => setAudioFormat(event.target.value as typeof audioFormat)}>
                    {AUDIO_FORMATS.map((option) => (
                      <option key={option} value={option}>{option.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="dl-quality">Audio quality</label>
                  <select id="dl-quality" className="select" value={settings.audioQuality} onChange={(event) => void onSettingsChange({ audioQuality: event.target.value as '0' | '2' | '5' })}>
                    <option value="0">Best (VBR 0)</option>
                    <option value="2">Good (VBR 2)</option>
                    <option value="5">Small (VBR 5)</option>
                  </select>
                </div>
              </>
            )}
          </div>

          {!ffmpegOk ? (
            <div className="row" style={{ marginTop: 14 }}>
              <TriangleAlert size={15} style={{ color: 'var(--warn)' }} />
              <span className="hint grow">
                {mode === 'audio_only'
                  ? 'ffmpeg is not installed, so audio is saved as M4A without conversion.'
                  : 'ffmpeg is not installed, so only lower-quality single-file video is available.'}
              </span>
              <button type="button" className="btn small" disabled={ffmpegBusy} onClick={() => void onInstallFfmpeg()}>
                <Download size={14} />
                <span>{ffmpegBusy ? 'Installing...' : 'Install ffmpeg'}</span>
              </button>
            </div>
          ) : null}

          <div className="row" style={{ marginTop: 16 }}>
            <label className="check">
              <input type="checkbox" checked={writeThumbs} onChange={(event) => setWriteThumbs(event.target.checked)} />
              <span>Thumbnail image</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={writeInfo} onChange={(event) => setWriteInfo(event.target.checked)} />
              <span>Metadata file</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={writeSubs} onChange={(event) => setWriteSubs(event.target.checked)} />
              <span>Subtitles</span>
            </label>
            {writeSubs ? (
              <input
                className="input"
                style={{ width: 160 }}
                value={subLangs}
                spellCheck={false}
                placeholder="en,es"
                onChange={(event) => setSubLangs(event.target.value)}
              />
            ) : null}
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button type="button" className="btn primary" onClick={() => void startSingle()} disabled={!ytdlpReady}>
              <Download size={15} />
              <span>{mode === 'audio_only' ? 'Download audio' : 'Download video'}</span>
            </button>
            <button type="button" className="btn ghost" onClick={() => { setMeta(null); setSelected(new Set()) }}>
              <X size={15} />
              <span>Clear</span>
            </button>
            {meta.isPlaylist ? <span className="stat">{selected.size} video(s) will be downloaded one by one.</span> : null}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="segmented">
            <button type="button" className={queueFilter === 'active' ? 'active' : ''} onClick={() => setQueueFilter('active')}>
              Queue{activeCount ? ' · ' + activeCount : ''}
            </button>
            <button type="button" className={queueFilter === 'history' ? 'active' : ''} onClick={() => setQueueFilter('history')}>
              History{finishedCount ? ' · ' + finishedCount : ''}
            </button>
          </div>
          <div className="row tight" style={{ marginLeft: 'auto' }}>
            <span className="stat">Up to {settings.concurrentDownloads} at once</span>
            <button type="button" className="btn small ghost" onClick={() => void clearFinished()} disabled={!finishedCount}>
              <Trash2 size={14} />
              <span>Clear finished</span>
            </button>
          </div>
        </div>

        {visibleJobs.length ? (
          <div>
            {visibleJobs.map((job) => (
              <div className="job" key={job.id}>
                {job.thumbnail ? <img className="job-thumb" src={job.thumbnail} alt="" /> : <div className="job-thumb" />}
                <div style={{ minWidth: 0 }}>
                  <div className="job-title" title={job.title}>{job.title}</div>
                  {job.status === 'error' && job.error ? (
                    <div className="hint wrap-anywhere" style={{ color: 'var(--err)' }}>{job.error}</div>
                  ) : (
                    <ProgressBar value={job.percent} status={job.status} />
                  )}
                  <div className="job-sub">
                    <span>{job.qualityLabel}</span>
                    <span>{job.status === 'completed' ? formatBytes(job.downloadedBytes || job.totalBytes) : formatBytes(job.downloadedBytes) + (job.totalBytes ? ' / ' + formatBytes(job.totalBytes) : '')}</span>
                    {job.speed ? <span>{job.speed}</span> : null}
                    {job.eta && job.status !== 'completed' ? <span>ETA {job.eta}</span> : null}
                    <span>{Math.round(job.percent) + '%'}</span>
                    <span>{timeAgo(job.createdAt)}</span>
                    <span className={'chip ' + (job.status === 'completed' ? 'ok' : job.status === 'error' ? 'err' : job.status === 'canceled' ? 'warn' : '')}>{job.status}</span>
                  </div>
                </div>
                <div className="job-actions">
                  {job.status === 'completed' && job.outputPath ? (
                    <button type="button" className="btn small" title="Show in folder" onClick={() => void window.api.revealPath(job.outputPath as string)}>
                      <FolderOpen size={15} />
                    </button>
                  ) : null}
                  {job.status === 'downloading' || job.status === 'processing' || job.status === 'queued' ? (
                    <button type="button" className="btn small danger" onClick={() => void cancelJob(job.id)}>
                      <X size={15} />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button type="button" className="btn small" onClick={() => void retryJob(job.id)}>
                      <RotateCcw size={15} />
                      <span>Retry</span>
                    </button>
                  )}
                  <button type="button" className="btn small ghost" title="Remove from list" onClick={() => void removeJob(job.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ListVideo size={36} />}
            title={queueFilter === 'active' ? 'Nothing in the queue' : 'No finished downloads yet'}
            message="Analyze a link above, choose a resolution, and it will show up here with live progress."
          />
        )}
      </div>
    </div>
  )
}
