import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpToLine,
  ChevronDown,
  ClipboardPaste,
  Download,
  Film,
  FolderOpen,
  FolderSync,
  Layers,
  ListVideo,
  Loader2,
  Music,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Scissors,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import type { AudioFormat, DownloadJob, DownloadMode, DownloadRequest, LibraryState, SavedPlaylist, Settings, VideoMeta } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { explainError, type ErrorFix } from '../lib/errors'
import { formatBytes, formatCount, formatDuration, parseTime, timeAgo } from '../lib/format'
import { estimateAudioSize, estimateVideoSize } from '../lib/sizes'
import type { DownloadDraft, PushToast } from '../lib/types'
import { EmptyState, LoadingRow, ProgressBar, Switch, hideBroken } from './common'

interface Props {
  settings: Settings
  jobs: DownloadJob[]
  pushToast: PushToast
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
  ytdlpReady: boolean
  ffmpegOk: boolean
  ffmpegBusy: boolean
  onInstallFfmpeg: () => Promise<void>
  onUpdateYtdlp: () => Promise<void>
  onOpenSettings: () => void
  onPlayFile: (absPath: string) => void
  draft: DownloadDraft | null
  libState: LibraryState
  syncing: string[]
  onSync: (playlist: SavedPlaylist) => void
  onSyncAll: () => void
}

const AUDIO_FORMATS: { id: AudioFormat; note: string }[] = [
  { id: 'mp3', note: 'plays everywhere' },
  { id: 'm4a', note: 'original quality' },
  { id: 'opus', note: 'smallest' },
  { id: 'flac', note: 'lossless file' },
  { id: 'wav', note: 'uncompressed' },
]
const HEIGHTS = [2160, 1440, 1080, 720, 480, 360]

const isPending = (job: DownloadJob): boolean => job.status === 'downloading' || job.status === 'processing' || job.status === 'queued' || job.status === 'paused'

export default function DownloadTab({
  settings,
  jobs,
  pushToast,
  onSettingsChange,
  ytdlpReady,
  ffmpegOk,
  ffmpegBusy,
  onInstallFfmpeg,
  onUpdateYtdlp,
  onOpenSettings,
  onPlayFile,
  draft,
  libState,
  syncing,
  onSync,
  onSyncAll,
}: Props): ReactNode {
  const [url, setUrl] = useState('')
  const [batchMode, setBatchMode] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [entryFilter, setEntryFilter] = useState('')
  const [mode, setMode] = useState<DownloadMode>(settings.defaultMode)
  const [height, setHeight] = useState<number>(settings.preferredHeight)
  const [audioFormat, setAudioFormat] = useState(settings.audioFormat)
  const [writeSubs, setWriteSubs] = useState(settings.writeSubtitles)
  const [subLangs, setSubLangs] = useState(settings.subtitleLanguages)
  const [writeThumbs, setWriteThumbs] = useState(settings.writeThumbnails)
  const [writeInfo, setWriteInfo] = useState(settings.writeMetadata)
  const [sponsorBlock, setSponsorBlock] = useState(settings.sponsorBlock)
  const [clipFrom, setClipFrom] = useState('')
  const [clipTo, setClipTo] = useState('')
  const [queueFilter, setQueueFilter] = useState<'active' | 'history'>('active')
  const [historySearch, setHistorySearch] = useState('')
  const [useFolder, setUseFolder] = useState(settings.playlistFolders)
  const [keepSynced, setKeepSynced] = useState(true)
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
    setUseFolder(settings.playlistFolders)
    setSponsorBlock(settings.sponsorBlock)
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
      setClipFrom('')
      setClipTo('')
      setEntryFilter('')
      try {
        const result = await unwrap(window.api.probe(value))
        setMeta(result)
        if (result.isPlaylist) {
          setSelected(new Set(result.entries.map((entry) => entry.id)))
          pushToast('Playlist detected: ' + result.entryCount + ' videos.', 'info')
        } else {
          setSelected(new Set())
          setUrl(result.url)
        }
      } catch (err) {
        pushToast(errorMessage(err), 'error')
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

  const clip = useMemo(() => {
    const start = parseTime(clipFrom)
    const end = parseTime(clipTo)
    const invalid = (clipFrom.trim() !== '' && start === null) || (clipTo.trim() !== '' && end === null) || (start !== null && end !== null && end <= start)
    return { start, end, invalid, active: !invalid && (start !== null || end !== null) }
  }, [clipFrom, clipTo])

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
      sponsorBlock: ffmpegOk && sponsorBlock,
      ...extra,
    }),
    [mode, height, audioFormat, settings.audioQuality, writeSubs, subLangs, writeThumbs, writeInfo, sponsorBlock, ffmpegOk],
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

  const startSingle = useCallback(async (everything = false) => {
    if (!meta) return
    if (clip.invalid) {
      pushToast('Check the clip times: use 1:23 or 83, and the end must come after the start.', 'error')
      return
    }
    try {
      let requests: DownloadRequest[]
      if (meta.isPlaylist) {
        const picked = meta.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => everything || selected.has(entry.id))
        if (!picked.length) {
          pushToast('Pick at least one video from the playlist.', 'error')
          return
        }
        if (everything) setSelected(new Set(meta.entries.map((entry) => entry.id)))
        const folder = useFolder ? meta.playlistTitle ?? meta.title : null
        requests = picked.map(({ entry, index }) =>
          buildRequest(entry.url, {
            videoId: entry.id,
            title: entry.title,
            uploader: entry.uploader,
            thumbnail: entry.thumbnail,
            duration: entry.duration,
            folder,
            playlistIndex: index + 1,
          }),
        )
        if (keepSynced) {
          // Whatever was left unticked now is not fetched by a later sync either.
          await unwrap(
            window.api.savePlaylist({
              id: meta.id || meta.url,
              url: meta.url,
              title: meta.title,
              folder,
              mode,
              height: mode === 'audio_only' ? null : height,
              audioFormat,
              thumbnail: meta.thumbnail,
              knownIds: meta.entries.map((entry) => entry.id),
              lastSync: Date.now(),
              lastAdded: picked.length,
            }),
          )
        }
      } else {
        requests = [
          buildRequest(meta.url, {
            videoId: meta.id,
            title: meta.title,
            uploader: meta.uploader,
            thumbnail: meta.thumbnail,
            duration: meta.duration,
            clipStart: clip.active ? clip.start : null,
            clipEnd: clip.active ? clip.end : null,
          }),
        ]
      }
      await unwrap(window.api.createJobs(requests))
      setQueueFilter('active')
      pushToast(requests.length + ' download(s) queued.' + (meta.isPlaylist && keepSynced ? ' Playlist saved: Sync grabs new videos later.' : ''), 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [meta, selected, buildRequest, pushToast, useFolder, keepSynced, mode, height, audioFormat, clip])

  const call = useCallback(
    async (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>) => {
      try {
        await unwrap(fn())
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  const bulk = useCallback(
    async (fn: () => Promise<{ ok: true; data: number } | { ok: false; error: string }>, label: string) => {
      try {
        const n = await unwrap(fn())
        if (n) pushToast(n + ' download(s) ' + label + '.', 'info')
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  const fix = (kind: ErrorFix, job: DownloadJob): void => {
    if (kind === 'update-ytdlp') void onUpdateYtdlp().then(() => call(() => window.api.retryJob(job.id)))
    else if (kind === 'install-ffmpeg') void onInstallFfmpeg().then(() => call(() => window.api.retryJob(job.id)))
    else if (kind === 'cookies' || kind === 'network') onOpenSettings()
    else void call(() => window.api.retryJob(job.id))
  }

  const visibleJobs = useMemo(() => {
    if (queueFilter === 'active') return jobs.filter(isPending).slice().sort((a, b) => a.createdAt - b.createdAt)
    const query = historySearch.trim().toLowerCase()
    return jobs.filter((job) => !isPending(job) && (!query || (job.title + ' ' + (job.uploader ?? '') + ' ' + (job.folder ?? '')).toLowerCase().includes(query)))
  }, [jobs, queueFilter, historySearch])

  const pending = jobs.filter(isPending)
  const queuedCount = pending.length
  const finishedCount = jobs.length - queuedCount
  const pausedCount = jobs.filter((job) => job.status === 'paused').length
  const failedCount = jobs.filter((job) => job.status === 'error').length
  const running = jobs.filter((job) => job.status === 'downloading' || job.status === 'processing')
  const overall = pending.length ? pending.reduce((sum, job) => sum + (job.status === 'queued' || job.status === 'paused' ? 0 : job.percent), 0) / pending.length : 0
  const speeds = running.map((job) => job.speed).filter(Boolean)

  const heights = meta && meta.heights.length ? HEIGHTS.filter((h) => meta.heights.some((m) => m >= h * 0.9)) : HEIGHTS.slice(2)
  const entryQuery = entryFilter.trim().toLowerCase()
  const entries = meta?.isPlaylist ? meta.entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => !entryQuery || entry.title.toLowerCase().includes(entryQuery)) : []
  const audioSize = meta && !meta.isPlaylist ? estimateAudioSize(meta.formats, meta.duration) : null

  return (
    <div className="panel-scroll">
      <div className="panel-narrow">
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="segmented">
              <button type="button" className={!batchMode ? 'active' : ''} onClick={() => setBatchMode(false)}>Single link</button>
              <button type="button" className={batchMode ? 'active' : ''} onClick={() => setBatchMode(true)}>Batch mode</button>
            </div>
            <span className="hint spacer" title={settings.downloadsDir}>
              Saving to <span className="mono">{settings.downloadsDir}</span>
            </span>
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
                <span className="hint">Each line becomes its own download using your default quality ({settings.defaultMode === 'audio_only' ? settings.audioFormat.toUpperCase() + ' audio' : settings.preferredHeight ? 'up to ' + settings.preferredHeight + 'p' : 'best video'}).</span>
              </div>
            </>
          ) : (
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
                      if (text.trim()) {
                        setUrl(text.trim())
                        void analyze(text.trim())
                      } else pushToast('Clipboard is empty.', 'info')
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
                {analyzing ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
                <span>{analyzing ? 'Reading' : 'Analyze'}</span>
              </button>
            </div>
          )}
        </div>

        {analyzing ? <LoadingRow label="Reading title, formats and resolutions..." /> : null}

        {meta && !analyzing ? (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="preview">
              <div className="thumb">
                {meta.thumbnail ? <img src={meta.thumbnail} alt="" onError={hideBroken} /> : <div className="placeholder"><Film size={26} /></div>}
                {meta.duration ? <span className="duration">{formatDuration(meta.duration)}</span> : null}
              </div>
              <div style={{ minWidth: 0 }}>
                <h2>{meta.title}</h2>
                <div className="preview-meta">
                  {meta.uploader ? <span className="chip">{meta.uploader}</span> : null}
                  {meta.isPlaylist ? <span className="chip soft"><Layers size={12} /> playlist · {meta.entryCount}</span> : null}
                  {meta.isLive ? <span className="chip warn">live</span> : null}
                  {meta.viewCount ? <span className="chip">{formatCount(meta.viewCount)} views</span> : null}
                  {meta.subtitles.length ? <span className="chip">{meta.subtitles.length} subtitle language(s)</span> : null}
                </div>

                <div className="mode-tiles">
                  <button type="button" className={'mode-tile' + (mode === 'video_audio' ? ' active' : '')} onClick={() => setMode('video_audio')}>
                    <span className="mode-icon"><Film size={17} /></span>
                    <span><strong>Video (with audio)</strong><span>MP4 that plays everywhere</span></span>
                  </button>
                  <button type="button" className={'mode-tile' + (mode === 'audio_only' ? ' active' : '')} onClick={() => setMode('audio_only')}>
                    <span className="mode-icon"><Music size={17} /></span>
                    <span><strong>Audio only</strong><span>Music, podcasts, talks</span></span>
                  </button>
                </div>
              </div>
            </div>

            {mode !== 'audio_only' ? (
              <>
                <div className="section-label">Quality {meta.isPlaylist ? '(up to, per video)' : ''}</div>
                <div className="q-grid">
                  {[0, ...heights].map((option) => {
                    const size = !meta.isPlaylist ? estimateVideoSize(meta.formats, option, meta.duration, settings.videoCodec, ffmpegOk) : null
                    return (
                      <button key={option} type="button" className={'q-card' + (height === option ? ' active' : '')} onClick={() => setHeight(option)}>
                        {option === 0 ? <span className="q-tag">Best</span> : option >= 2160 ? <span className="q-tag">4K</span> : option >= 1440 ? <span className="q-tag">2K</span> : option >= 1080 ? <span className="q-tag">Full HD</span> : null}
                        <strong>{option === 0 ? 'Best available' : option + 'p'}</strong>
                        <span>{size ? '≈ ' + formatBytes(size) : option && option <= 480 ? 'small file' : ' '}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <div className="section-label">Audio format {audioSize ? <span className="hint" style={{ textTransform: 'none', letterSpacing: 0 }}>· about {formatBytes(audioSize)}</span> : null}</div>
                <div className="q-grid">
                  {AUDIO_FORMATS.map((option) => (
                    <button key={option.id} type="button" className={'q-card' + (audioFormat === option.id ? ' active' : '')} disabled={!ffmpegOk && option.id !== 'm4a'} onClick={() => setAudioFormat(option.id)}>
                      <strong>{option.id.toUpperCase()}</strong>
                      <span>{option.note}</span>
                    </button>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <span className="hint">Quality</span>
                  <div className="segmented">
                    {(['0', '2', '5'] as const).map((q) => (
                      <button key={q} type="button" className={settings.audioQuality === q ? 'active' : ''} onClick={() => void onSettingsChange({ audioQuality: q })}>
                        {q === '0' ? 'Best' : q === '2' ? 'Good' : 'Small'}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {!ffmpegOk ? (
              <div className="row" style={{ marginTop: 14 }}>
                <TriangleAlert size={15} style={{ color: 'var(--warn)' }} />
                <span className="hint grow">
                  {mode === 'audio_only'
                    ? 'ffmpeg is not installed, so audio is saved as M4A without conversion.'
                    : 'ffmpeg is not installed, so only lower-quality single-file video is available, and clips and SponsorBlock are off.'}
                </span>
                <button type="button" className="btn small" disabled={ffmpegBusy} onClick={() => void onInstallFfmpeg()}>
                  <Download size={14} />
                  <span>{ffmpegBusy ? 'Installing...' : 'Install ffmpeg'}</span>
                </button>
              </div>
            ) : null}

            <details className="more">
              <summary>
                <SlidersHorizontal size={15} style={{ color: 'var(--accent)' }} />
                <span>More options</span>
                {clip.active ? <span className="chip soft">clip</span> : null}
                {sponsorBlock && ffmpegOk ? <span className="chip soft">no sponsors</span> : null}
                {writeSubs ? <span className="chip soft">subtitles</span> : null}
                <ChevronDown size={16} className="chev" />
              </summary>
              <div className="more-body">
                {!meta.isPlaylist ? (
                  <div>
                    <div className="row tight">
                      <Scissors size={15} style={{ color: 'var(--text-dim)' }} />
                      <strong style={{ fontSize: 13 }}>Only a part of the video</strong>
                    </div>
                    <div className="row tight" style={{ marginTop: 8 }}>
                      <input className="input time-input" placeholder="0:00" value={clipFrom} disabled={!ffmpegOk} onChange={(event) => setClipFrom(event.target.value)} aria-label="Clip start" />
                      <span className="hint">to</span>
                      <input className="input time-input" placeholder={meta.duration ? formatDuration(meta.duration) : 'end'} value={clipTo} disabled={!ffmpegOk} onChange={(event) => setClipTo(event.target.value)} aria-label="Clip end" />
                      <span className="hint" style={{ color: clip.invalid ? 'var(--err)' : undefined }}>
                        {clip.invalid
                          ? 'Use 1:23 or 83; the end must be after the start.'
                          : clip.active
                            ? 'Saves ' + formatDuration((clip.end ?? meta.duration ?? 0) - (clip.start ?? 0)) + ' (cut at the nearest keyframe).'
                            : 'Leave empty for the whole video.'}
                      </span>
                    </div>
                  </div>
                ) : null}
                <Switch
                  checked={sponsorBlock && ffmpegOk}
                  disabled={!ffmpegOk}
                  onChange={setSponsorBlock}
                  label={<span><ShieldCheck size={13} style={{ verticalAlign: -2, color: 'var(--ok)' }} /> Skip sponsors: cut sponsor, self-promo and "subscribe" segments (SponsorBlock)</span>}
                />
                <div className="row">
                  <Switch checked={writeThumbs} onChange={setWriteThumbs} label="Thumbnail image" />
                  <Switch checked={writeInfo} onChange={setWriteInfo} label="Metadata file" />
                  <Switch checked={writeSubs} onChange={setWriteSubs} label="Subtitles" />
                  {writeSubs ? (
                    <input className="input" style={{ width: 150 }} value={subLangs} spellCheck={false} placeholder="en,es" onChange={(event) => setSubLangs(event.target.value)} aria-label="Subtitle languages" />
                  ) : null}
                </div>
              </div>
            </details>

            {meta.isPlaylist ? (
              <div style={{ marginTop: 16 }}>
                <div className="row tight" style={{ marginBottom: 8 }}>
                  <button type="button" className="btn small" onClick={() => setSelected(new Set(meta.entries.map((entry) => entry.id)))}>Select all</button>
                  <button type="button" className="btn small" onClick={() => setSelected(new Set())}>Select none</button>
                  <span className="stat">{selected.size} of {meta.entryCount} selected</span>
                  <div className="search-wrap" style={{ maxWidth: 260, marginLeft: 'auto' }}>
                    <Search size={14} />
                    <input className="input" placeholder="Filter videos…" value={entryFilter} onChange={(event) => setEntryFilter(event.target.value)} />
                  </div>
                </div>
                <div className="scroll-y">
                  {entries.map(({ entry, index }) => (
                    <label key={entry.id + ':' + index} className="entry-row">
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
                      {entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" onError={hideBroken} /> : null}
                      <span className="label">{entry.title}</span>
                      <span className="stat">{entry.duration ? formatDuration(entry.duration) : ''}</span>
                    </label>
                  ))}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <Switch checked={useFolder} onChange={setUseFolder} label="Own folder, in playlist order" />
                  <Switch checked={keepSynced} onChange={setKeepSynced} label="Keep in sync (Sync later downloads only new videos)" />
                </div>
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 18 }}>
              {meta.isPlaylist ? (
                <button type="button" className="btn primary large" onClick={() => void startSingle(true)} disabled={!ytdlpReady}>
                  <Download size={15} />
                  <span>Download whole playlist ({meta.entries.length})</span>
                </button>
              ) : null}
              <button type="button" className={meta.isPlaylist ? 'btn large' : 'btn primary large'} onClick={() => void startSingle()} disabled={!ytdlpReady || (meta.isPlaylist && !selected.size) || clip.invalid}>
                <Download size={15} />
                <span>{meta.isPlaylist ? 'Download ' + selected.size + ' selected' : mode === 'audio_only' ? 'Download audio' : 'Download video'}</span>
              </button>
              <button type="button" className="btn ghost" onClick={() => { setMeta(null); setSelected(new Set()) }}>
                <X size={15} />
                <span>Clear</span>
              </button>
              {meta.isPlaylist ? <span className="stat">Videos download one after another (up to {settings.concurrentDownloads} at once).</span> : null}
            </div>
          </div>
        ) : null}

        {libState.saved.length ? (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="row" style={{ marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}><FolderSync size={15} /><span>Synced playlists and channels</span></div>
              <span className="hint">{settings.autoSyncHours ? 'Auto-sync every ' + settings.autoSyncHours + ' h' : 'Auto-sync is off'}</span>
              <button type="button" className="btn small" style={{ marginLeft: 'auto' }} disabled={!ytdlpReady || syncing.length > 0} onClick={onSyncAll}>
                <RefreshCw size={14} className={syncing.length ? 'spin' : ''} />
                <span>Sync all</span>
              </button>
            </div>
            {libState.saved.map((saved) => (
              <div className="saved-row" key={saved.id}>
                {saved.thumbnail ? <img className="job-thumb" src={saved.thumbnail} alt="" onError={hideBroken} /> : <div className="job-thumb" />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="job-title" title={saved.title}>{saved.title}</div>
                  <div className="stat">
                    {saved.knownIds.length} videos · {saved.mode === 'audio_only' ? saved.audioFormat.toUpperCase() + ' audio' : saved.height ? 'up to ' + saved.height + 'p' : 'best quality'}
                    {' · synced ' + timeAgo(saved.lastSync)}
                    {saved.folder ? ' · folder "' + saved.folder + '"' : ''}
                  </div>
                </div>
                <button type="button" className="btn small" disabled={!ytdlpReady || syncing.includes(saved.id)} onClick={() => onSync(saved)}>
                  <RefreshCw size={14} className={syncing.includes(saved.id) ? 'spin' : ''} />
                  <span>{syncing.includes(saved.id) ? 'Syncing' : 'Sync'}</span>
                </button>
                <button type="button" className="btn small ghost" title="Stop syncing" onClick={() => void window.api.removeSavedPlaylist(saved.id)}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="segmented">
              <button type="button" className={queueFilter === 'active' ? 'active' : ''} onClick={() => setQueueFilter('active')}>
                Queue{queuedCount ? ' · ' + queuedCount : ''}
              </button>
              <button type="button" className={queueFilter === 'history' ? 'active' : ''} onClick={() => setQueueFilter('history')}>
                History{finishedCount ? ' · ' + finishedCount : ''}
              </button>
            </div>
            <div className="row tight" style={{ marginLeft: 'auto' }}>
              {queueFilter === 'active' ? (
                <>
                  <button type="button" className="btn small ghost" disabled={!running.length && !jobs.some((j) => j.status === 'queued')} onClick={() => void bulk(() => window.api.pauseAll(), 'paused')}>
                    <Pause size={14} />
                    <span>Pause all</span>
                  </button>
                  <button type="button" className="btn small ghost" disabled={!pausedCount} onClick={() => void bulk(() => window.api.resumeAll(), 'resumed')}>
                    <Play size={14} />
                    <span>Resume all</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="search-wrap" style={{ width: 220, flex: 'none' }}>
                    <Search size={14} />
                    <input className="input" placeholder="Search history…" value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} />
                  </div>
                  <button type="button" className="btn small ghost" disabled={!failedCount} onClick={() => void bulk(() => window.api.retryFailed(), 'retried')}>
                    <RotateCcw size={14} />
                    <span>Retry failed</span>
                  </button>
                </>
              )}
              <button type="button" className="btn small ghost" onClick={() => void call(() => window.api.clearFinishedJobs())} disabled={!finishedCount}>
                <Trash2 size={14} />
                <span>Clear finished</span>
              </button>
            </div>
          </div>

          {queueFilter === 'active' && pending.length ? (
            <div className="queue-summary">
              <span className="stat" style={{ color: 'var(--text)' }}>
                <strong>{running.length}</strong>&nbsp;running · {jobs.filter((j) => j.status === 'queued').length} waiting{pausedCount ? ' · ' + pausedCount + ' paused' : ''}
              </span>
              <ProgressBar value={overall} status={running.length ? 'downloading' : pausedCount ? 'paused' : 'queued'} />
              <span className="stat">{speeds.length ? speeds.join(' + ') : ''}</span>
              <span className="stat">Up to {settings.concurrentDownloads} at once{settings.rateLimit ? ' · capped at ' + settings.rateLimit + 'B/s' : ''}</span>
            </div>
          ) : null}

          {visibleJobs.length ? (
            <div>
              {visibleJobs.map((job) => {
                const help = job.status === 'error' ? explainError(job.error) : null
                return (
                  <div className={'job' + (job.status === 'error' ? ' failed' : '')} key={job.id}>
                    {job.thumbnail ? <img className="job-thumb" src={job.thumbnail} alt="" onError={hideBroken} /> : <div className="job-thumb" />}
                    <div style={{ minWidth: 0 }}>
                      <div className="job-title" title={job.title}>{job.title}</div>
                      {job.folder ? <div className="job-folder">{job.folder}{job.playlistIndex ? ' · #' + job.playlistIndex : ''}</div> : null}
                      {job.stage && job.status !== 'error' ? (
                        <div className={'job-stage' + (job.status === 'processing' ? ' processing' : job.status === 'paused' ? ' paused' : '')}>
                          {job.status === 'downloading' || job.status === 'processing' ? <Loader2 size={12} className="spin" /> : job.status === 'paused' ? <Pause size={12} /> : null}
                          <span>{job.stage}</span>
                        </div>
                      ) : null}
                      {job.status === 'error' && job.error ? (
                        <div className="job-error">
                          {help ? <strong>{help.title}</strong> : null}
                          <div className={help ? 'hint' : 'wrap-anywhere'} style={help ? undefined : { color: 'var(--err)' }}>{help ? help.hint : job.error}</div>
                          {help ? <div className="hint wrap-anywhere" style={{ marginTop: 4, opacity: 0.8 }} title={job.error}>{job.error.slice(0, 220)}</div> : null}
                          {help?.fix ? (
                            <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => fix(help.fix as ErrorFix, job)}>
                              {help.fix === 'update-ytdlp' ? 'Update yt-dlp and retry' : help.fix === 'install-ffmpeg' ? 'Install ffmpeg and retry' : help.fix === 'cookies' || help.fix === 'network' ? 'Open Settings' : 'Retry'}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <ProgressBar value={job.percent} status={job.status} />
                      )}
                      <div className="job-sub">
                        <span>{job.qualityLabel}</span>
                        <span>{job.status === 'completed' ? formatBytes(job.downloadedBytes || job.totalBytes) : formatBytes(job.downloadedBytes) + (job.totalBytes ? ' / ' + formatBytes(job.totalBytes) : '')}</span>
                        {job.speed ? <span>{job.speed}</span> : null}
                        {job.eta && job.status !== 'completed' ? <span>ETA {job.eta}</span> : null}
                        {job.status === 'downloading' && job.percent > 0 ? <span>{Math.round(job.percent) + '%'}</span> : null}
                        {job.status === 'completed' ? <span>100%</span> : null}
                        <span>{timeAgo(job.finishedAt ?? job.createdAt)}</span>
                        <span className={'chip ' + (job.status === 'completed' ? 'ok' : job.status === 'error' ? 'err' : job.status === 'canceled' || job.status === 'paused' ? 'warn' : '')}>{job.status}</span>
                      </div>
                    </div>
                    <div className="job-actions">
                      {job.status === 'completed' && job.outputPath ? (
                        <>
                          <button type="button" className="btn small primary" title="Play" onClick={() => onPlayFile(job.outputPath as string)}>
                            <Play size={14} />
                          </button>
                          <button type="button" className="btn small" title="Show in folder" onClick={() => void window.api.revealPath(job.outputPath as string)}>
                            <FolderOpen size={15} />
                          </button>
                        </>
                      ) : null}
                      {job.status === 'queued' ? (
                        <button type="button" className="btn small ghost" title="Download next" onClick={() => void call(() => window.api.prioritizeJob(job.id))}>
                          <ArrowUpToLine size={15} />
                        </button>
                      ) : null}
                      {job.status === 'downloading' || job.status === 'queued' ? (
                        <button type="button" className="btn small" title="Pause" onClick={() => void call(() => window.api.pauseJob(job.id))}>
                          <Pause size={14} />
                        </button>
                      ) : null}
                      {job.status === 'paused' ? (
                        <button type="button" className="btn small primary" title="Resume" onClick={() => void call(() => window.api.resumeJob(job.id))}>
                          <Play size={14} />
                          <span>Resume</span>
                        </button>
                      ) : null}
                      {isPending(job) ? (
                        <button type="button" className="btn small danger" onClick={() => void call(() => window.api.cancelJob(job.id))}>
                          <X size={15} />
                          <span>Stop</span>
                        </button>
                      ) : (
                        <button type="button" className="btn small" onClick={() => void call(() => window.api.retryJob(job.id))}>
                          <RotateCcw size={15} />
                          <span>Retry</span>
                        </button>
                      )}
                      <button type="button" className="btn small ghost" title="Remove from list" onClick={() => void call(() => window.api.removeJob(job.id))}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={<ListVideo size={34} />}
              title={queueFilter === 'active' ? 'Nothing in the queue' : historySearch ? 'No matches' : 'No finished downloads yet'}
              message={queueFilter === 'active' ? 'Analyze a link above, choose a quality, and it shows up here with live progress. You can pause and resume any time.' : 'Finished and failed downloads are listed here, with Play, Show in folder and Retry.'}
            />
          )}
        </div>
      </div>
    </div>
  )
}
