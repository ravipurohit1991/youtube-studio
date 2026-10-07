import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Clapperboard,
  ClipboardPaste,
  Clock3,
  Command,
  Download,
  Film,
  FolderSync,
  HardDrive,
  Headphones,
  History,
  Layers,
  Library as LibraryIcon,
  Link2,
  ListVideo,
  Loader2,
  MousePointerClick,
  Music,
  Play,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react'
import type { AiStatus, DownloadJob, DownloadMode, DownloadRequest, LibraryItem, LibraryState, Settings, TabId, VideoMeta } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatCount, formatDuration, formatHours, greeting, timeAgo, ytThumb } from '../lib/format'
import { streamHistory, type StreamHistoryEntry } from '../lib/prefs'
import { estimateAudioSize, estimateVideoSize } from '../lib/sizes'
import type { LinkDraft, PushToast } from '../lib/types'
import { Kbd, MediaThumb, ProgressBar, Switch, hideBroken, isInProgress } from './common'

interface Props {
  settings: Settings
  jobs: DownloadJob[]
  library: LibraryItem[]
  libState: LibraryState
  aiStatus: AiStatus | null
  ytdlpReady: boolean
  ffmpegOk: boolean
  draft: LinkDraft | null
  pushToast: PushToast
  onTab: (tab: TabId) => void
  onPlay: (list: LibraryItem[], index: number, shuffle?: boolean) => void
  onStream: (url: string, startAt?: number, audioOnly?: boolean) => void
  onDownloadOptions: (url: string, mode: DownloadMode) => void
}

/** The front door: paste anything, get the obvious actions; plus what is going on and what to continue. */
export default function HomeTab({ settings, jobs, library, libState, aiStatus, ytdlpReady, ffmpegOk, draft, pushToast, onTab, onPlay, onStream, onDownloadOptions }: Props): ReactNode {
  const [url, setUrl] = useState('')
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [keepSynced, setKeepSynced] = useState(true)
  const [history, setHistory] = useState<StreamHistoryEntry[]>(() => streamHistory())
  const handled = useRef(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const refresh = (): void => setHistory(streamHistory())
    window.addEventListener('stream-history', refresh)
    return () => window.removeEventListener('stream-history', refresh)
  }, [])

  const look = useCallback(
    async (target?: string) => {
      const value = (target ?? url).trim()
      if (!value) {
        inputRef.current?.focus()
        return
      }
      setUrl(value)
      setLoading(true)
      setMeta(null)
      try {
        setMeta(await unwrap(window.api.probe(value)))
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      } finally {
        setLoading(false)
      }
    },
    [url, pushToast],
  )

  useEffect(() => {
    if (!draft || handled.current === draft.nonce) return
    handled.current = draft.nonce
    void look(draft.url)
  }, [draft, look])

  const paste = async (): Promise<void> => {
    try {
      const text = (await unwrap(window.api.readClipboard())).trim()
      if (!text) pushToast('The clipboard is empty.', 'info')
      else void look(text)
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const queue = async (mode: DownloadMode): Promise<void> => {
    if (!meta) return
    const base: Partial<DownloadRequest> = {
      mode,
      height: mode === 'audio_only' ? null : settings.preferredHeight,
      audioFormat: settings.audioFormat,
      audioQuality: settings.audioQuality,
      sponsorBlock: settings.sponsorBlock,
    }
    try {
      let requests: DownloadRequest[]
      if (meta.isPlaylist) {
        const folder = settings.playlistFolders ? meta.playlistTitle ?? meta.title : null
        requests = meta.entries.map((entry, index) => ({
          ...base,
          mode,
          url: entry.url,
          videoId: entry.id,
          title: entry.title,
          uploader: entry.uploader,
          thumbnail: entry.thumbnail,
          duration: entry.duration,
          folder,
          playlistIndex: index + 1,
        }))
        if (keepSynced) {
          await unwrap(
            window.api.savePlaylist({
              id: meta.id || meta.url,
              url: meta.url,
              title: meta.title,
              folder,
              mode,
              height: mode === 'audio_only' ? null : settings.preferredHeight,
              audioFormat: settings.audioFormat,
              thumbnail: meta.thumbnail,
              knownIds: meta.entries.map((entry) => entry.id),
              lastSync: Date.now(),
              lastAdded: requests.length,
            }),
          )
        }
      } else {
        requests = [{ ...base, mode, url: meta.url, videoId: meta.id, title: meta.title, uploader: meta.uploader, thumbnail: meta.thumbnail, duration: meta.duration }]
      }
      await unwrap(window.api.createJobs(requests))
      pushToast(
        (requests.length === 1 ? 'Downloading "' + requests[0].title + '"' : requests.length + ' downloads queued') + (mode === 'audio_only' ? ' as audio.' : '.'),
        'success',
        { actions: [{ label: 'View queue', onClick: () => onTab('download') }] },
      )
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  // Running first, then the waiting ones in queue order.
  const active = useMemo(
    () =>
      jobs
        .filter((j) => j.status === 'downloading' || j.status === 'processing' || j.status === 'queued')
        .sort((a, b) => (a.status === 'queued' ? 1 : 0) - (b.status === 'queued' ? 1 : 0) || a.createdAt - b.createdAt),
    [jobs],
  )
  const paused = useMemo(() => jobs.filter((j) => j.status === 'paused').length, [jobs])
  const continueWatching = useMemo(
    () =>
      library
        .filter((item) => isInProgress(libState.progress[item.key]))
        .sort((a, b) => (libState.progress[b.key]?.updatedAt ?? 0) - (libState.progress[a.key]?.updatedAt ?? 0))
        .slice(0, 12),
    [library, libState],
  )
  const recent = useMemo(() => library.slice().sort((a, b) => b.mtime - a.mtime).slice(0, 12), [library])
  const totals = useMemo(() => {
    const size = library.reduce((sum, item) => sum + item.size, 0)
    const seconds = library.reduce((sum, item) => sum + (item.duration ?? 0), 0)
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000
    const thisWeek = jobs.filter((j) => j.status === 'completed' && (j.finishedAt ?? 0) >= weekAgo).length
    const folders = new Set(library.map((item) => item.folder).filter(Boolean)).size
    return { size, seconds, thisWeek, playlists: folders + libState.playlists.length }
  }, [library, jobs, libState.playlists.length])

  const isEmpty = library.length === 0 && jobs.length === 0
  const videoSize = meta && !meta.isPlaylist ? estimateVideoSize(meta.formats, settings.preferredHeight, meta.duration, settings.videoCodec, ffmpegOk) : null
  const audioSize = meta && !meta.isPlaylist ? estimateAudioSize(meta.formats, meta.duration) : null
  const quality = settings.preferredHeight ? settings.preferredHeight + 'p' : 'best'

  return (
    <div className="panel-scroll">
      <div className="panel-narrow">
        <section className="home-hero">
          <h2>{greeting()}</h2>
          <p className="lead">Paste a YouTube video, playlist or channel. Watch it ad-free, or save it in one click.</p>
          <form
            className="link-bar"
            onSubmit={(event) => {
              event.preventDefault()
              void look()
            }}
          >
            <Link2 size={18} />
            <input
              ref={inputRef}
              aria-label="YouTube link"
              placeholder="https://youtube.com/watch?v=…  ·  a playlist  ·  a channel"
              value={url}
              spellCheck={false}
              onChange={(event) => setUrl(event.target.value)}
            />
            {url ? (
              <button type="button" className="icon-btn" title="Clear" onClick={() => { setUrl(''); setMeta(null) }}>
                <X size={16} />
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => void paste()} title="Paste from the clipboard">
              <ClipboardPaste size={15} />
              <span>Paste</span>
            </button>
            <button type="submit" className="btn gradient" disabled={loading || !ytdlpReady}>
              {loading ? <Loader2 size={15} className="spin" /> : <ArrowRight size={15} />}
              <span>Go</span>
            </button>
          </form>
          <div className="hero-hints">
            <span><Kbd keys="Ctrl+V" /> anywhere pastes a link</span>
            <span><MousePointerClick size={13} /> drop a link on the window</span>
            <span><Command size={13} /> <Kbd keys="Ctrl+K" /> for everything else</span>
          </div>
        </section>

        {loading ? (
          <div className="card quick-card">
            <div className="skeleton" style={{ aspectRatio: '16 / 9' }} />
            <div className="stack" style={{ gap: 10 }}>
              <div className="skeleton" style={{ height: 22, width: '70%' }} />
              <div className="skeleton" style={{ height: 14, width: '40%' }} />
              <div className="skeleton" style={{ height: 36, width: '80%', marginTop: 12 }} />
            </div>
          </div>
        ) : null}

        {meta && !loading ? (
          <div className="card quick-card">
            <div className="thumb">
              {meta.thumbnail ? <img src={meta.thumbnail} alt="" onError={hideBroken} /> : <div className="placeholder"><Film size={28} /></div>}
              {meta.duration ? <span className="duration">{formatDuration(meta.duration)}</span> : null}
            </div>
            <div style={{ minWidth: 0 }}>
              <h3>{meta.title}</h3>
              <div className="preview-meta">
                {meta.uploader ? <span className="chip">{meta.uploader}</span> : null}
                {meta.isPlaylist ? <span className="chip soft"><Layers size={12} /> {meta.entryCount} videos</span> : null}
                {meta.viewCount ? <span className="chip">{formatCount(meta.viewCount)} views</span> : null}
                {meta.isLive ? <span className="chip warn">live</span> : null}
              </div>
              {meta.isPlaylist ? (
                <>
                  <div className="quick-actions">
                    <button type="button" className="btn primary large" disabled={!ytdlpReady} onClick={() => void queue('video_audio')}>
                      <Download size={16} />
                      <span>Get all {meta.entries.length} as video</span>
                    </button>
                    <button type="button" className="btn large" disabled={!ytdlpReady} onClick={() => void queue('audio_only')}>
                      <Music size={16} />
                      <span>All as {settings.audioFormat.toUpperCase()}</span>
                    </button>
                    <button type="button" className="btn ghost large" onClick={() => onDownloadOptions(meta.url, settings.defaultMode)}>
                      <SlidersHorizontal size={16} />
                      <span>Choose videos…</span>
                    </button>
                  </div>
                  <div className="row" style={{ marginTop: 14 }}>
                    <Switch checked={keepSynced} onChange={setKeepSynced} label="Follow it: Sync later fetches only new uploads" />
                  </div>
                </>
              ) : (
                <>
                  <div className="quick-actions">
                    <button type="button" className="btn gradient large" onClick={() => onStream(meta.url)}>
                      <Play size={16} fill="currentColor" />
                      <span>Watch now</span>
                    </button>
                    <button type="button" className="btn large" onClick={() => onStream(meta.url, undefined, true)} title="Stream only the audio, like a podcast">
                      <Headphones size={16} />
                      <span>Listen</span>
                    </button>
                  </div>
                  <div className="quick-group">
                    <div className="section-label">Save it</div>
                    <div className="row tight">
                      <button type="button" className="btn primary" disabled={!ytdlpReady} onClick={() => void queue('video_audio')}>
                        <Film size={15} />
                        <span>Video · {quality}</span>
                        {videoSize ? <span className="stat" style={{ color: 'inherit', opacity: 0.8 }}>≈ {formatBytes(videoSize)}</span> : null}
                      </button>
                      <button type="button" className="btn" disabled={!ytdlpReady} onClick={() => void queue('audio_only')}>
                        <Music size={15} />
                        <span>Audio · {(ffmpegOk ? settings.audioFormat : 'm4a').toUpperCase()}</span>
                        {audioSize ? <span className="stat">≈ {formatBytes(audioSize)}</span> : null}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => onDownloadOptions(meta.url, settings.defaultMode)}>
                        <SlidersHorizontal size={15} />
                        <span>More options…</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        <div className="stat-tiles">
          <button type="button" className="stat-tile" onClick={() => onTab('library')}>
            <span className="tile-icon"><LibraryIcon size={19} /></span>
            <span>
              <span className="tile-value">{library.length}</span>
              <span className="tile-label">{library.length === 1 ? 'item in your library' : 'items in your library'}</span>
            </span>
          </button>
          <button type="button" className="stat-tile" onClick={() => onTab('library')}>
            <span className="tile-icon"><Clock3 size={19} /></span>
            <span>
              <span className="tile-value">{formatHours(totals.seconds)}</span>
              <span className="tile-label">to watch and listen offline</span>
            </span>
          </button>
          <button type="button" className="stat-tile" onClick={() => onTab('download')}>
            <span className="tile-icon"><HardDrive size={19} /></span>
            <span>
              <span className="tile-value">{formatBytes(totals.size)}</span>
              <span className="tile-label">{totals.thisWeek} downloaded this week</span>
            </span>
          </button>
          <button type="button" className="stat-tile" onClick={() => onTab('playlists')}>
            <span className="tile-icon"><ListVideo size={19} /></span>
            <span>
              <span className="tile-value">{totals.playlists}</span>
              <span className="tile-label">{libState.saved.length ? libState.saved.length + ' followed for new uploads' : 'playlists'}</span>
            </span>
          </button>
        </div>

        {active.length || paused ? (
          <div className="card" style={{ marginBottom: 22 }}>
            <div className="card-title">
              <Download size={15} />
              <span>{active.length ? 'Downloading now' : 'Paused downloads'}</span>
              <button type="button" className="link-btn" style={{ marginLeft: 'auto' }} onClick={() => onTab('download')}>
                Open the queue
              </button>
            </div>
            <div className="home-jobs">
              {active.slice(0, 4).map((job) => (
                <div key={job.id} className="home-job">
                  {job.thumbnail ? <img src={job.thumbnail} alt="" onError={hideBroken} /> : <span className="ph" />}
                  <div style={{ minWidth: 0 }}>
                    <div className="t">{job.title}</div>
                    <ProgressBar value={job.percent} status={job.status} />
                    <div className="s">{[job.stage, job.speed, job.eta ? 'ETA ' + job.eta : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="stat">{job.status === 'downloading' && job.percent > 0 ? Math.round(job.percent) + '%' : ''}</span>
                </div>
              ))}
              {active.length > 4 ? <div className="hint">and {active.length - 4} more…</div> : null}
              {!active.length && paused ? <div className="hint">{paused} paused. Resume them from the queue.</div> : null}
            </div>
          </div>
        ) : null}

        {continueWatching.length ? (
          <section className="shelf">
            <div className="shelf-head">
              <span className="shelf-title">Continue watching</span>
            </div>
            <div className="shelf-row">
              {continueWatching.map((item) => {
                const progress = libState.progress[item.key]
                return (
                  <button key={item.id} type="button" className="mini-card" onClick={() => onPlay([item], 0)} title={item.title ?? item.name}>
                    <MediaThumb item={item} progress={progress} />
                    <span className="mini-name">{item.title ?? item.name}</span>
                    <span className="mini-meta">{progress ? formatDuration(progress.duration - progress.position) + ' left' : ''}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        {recent.length ? (
          <section className="shelf">
            <div className="shelf-head">
              <span className="shelf-title">Recently added</span>
              <button type="button" className="link-btn" onClick={() => onTab('library')}>See all</button>
            </div>
            <div className="shelf-row">
              {recent.map((item, index) => (
                <button key={item.id} type="button" className="mini-card" onClick={() => onPlay(recent, index)} title={item.title ?? item.name}>
                  <MediaThumb item={item} progress={libState.progress[item.key]} />
                  <span className="mini-name">{item.title ?? item.name}</span>
                  <span className="mini-meta">{[item.uploader, timeAgo(item.mtime)].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {history.length ? (
          <section className="shelf">
            <div className="shelf-head">
              <span className="shelf-title">Recently streamed</span>
              <button type="button" className="link-btn" onClick={() => onTab('stream')}>Open Stream</button>
            </div>
            <div className="shelf-row">
              {history.slice(0, 12).map((entry) => (
                <button key={entry.videoId} type="button" className="mini-card" onClick={() => onStream(entry.url)} title={entry.title}>
                  <div className="thumb">
                    {ytThumb(entry.videoId) ? <img src={ytThumb(entry.videoId) as string} alt="" loading="lazy" onError={hideBroken} /> : null}
                    {entry.duration ? <span className="duration">{formatDuration(entry.duration)}</span> : null}
                  </div>
                  <span className="mini-name">{entry.title}</span>
                  <span className="mini-meta">{[entry.uploader, timeAgo(entry.at)].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {isEmpty ? (
          <>
            <div className="section-label">Get started</div>
            <div className="steps">
              <div className="step">
                <span className="step-num">1</span>
                <div><strong>Paste a link above</strong>A video, a whole playlist or a channel. Watch it right away without ads, or save it.</div>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <div><strong>Download in one click</strong>Video up to 4K or audio as MP3. Playlists get their own folder and can be followed for new uploads.</div>
              </div>
              <div className="step">
                <span className="step-num">3</span>
                <div><strong>Watch and organize</strong>The Library remembers where you stopped. Favorites, your own playlists, subtitles and more.</div>
              </div>
            </div>
          </>
        ) : null}

        <div className="two-col" style={{ marginTop: isEmpty ? 22 : 0 }}>
          <div className="card">
            <div className="card-title"><Sparkles size={15} /><span>Discover with AI</span></div>
            <p className="hint" style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.55 }}>
              Describe what you want to watch in plain words; your own algorithm plans the searches and ranks every result for you, with a reason for each pick.
            </p>
            <button type="button" className="btn" onClick={() => onTab('discover')}>
              <Sparkles size={14} />
              <span>{aiStatus?.ready ? 'Open Discover' : 'Set it up'}</span>
            </button>
          </div>
          <div className="card">
            <div className="card-title"><FolderSync size={15} /><span>Follow channels and playlists</span></div>
            <p className="hint" style={{ margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.55 }}>
              Paste a channel or playlist link and keep "Follow it" on. {settings.autoSyncHours ? 'New uploads download automatically every ' + settings.autoSyncHours + ' h.' : 'Turn on auto-sync in Settings to fetch new uploads on a schedule.'}
            </p>
            <div className="row tight">
              <button type="button" className="btn" onClick={() => onTab('download')}>
                <History size={14} />
                <span>{libState.saved.length ? libState.saved.length + ' followed' : 'Open downloads'}</span>
              </button>
              <button type="button" className="btn ghost" onClick={() => onTab('settings')}>
                <Clapperboard size={14} />
                <span>Auto-sync</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
