import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Ban,
  Download,
  Ellipsis,
  ExternalLink,
  FileText,
  Film,
  Globe,
  Loader2,
  Music,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Undo2,
  WandSparkles,
  X,
} from 'lucide-react'
import type {
  AiStatus,
  DiscoverLength,
  DiscoverRecency,
  DiscoverResult,
  DiscoverVideo,
  DownloadMode,
  DownloadRequest,
  Settings,
  TasteAction,
  TasteProfile,
} from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { newRequestId, useAiLive } from '../lib/ai'
import { formatCount, formatDuration } from '../lib/format'
import type { ToastTone } from '../lib/types'
import { EmptyState, MoreMenu, hideBroken } from './common'
import InsightPanel from './InsightPanel'

interface Props {
  settings: Settings
  aiStatus: AiStatus | null
  ytdlpReady: boolean
  pushToast: (message: string, tone?: ToastTone) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
  onPlay: (url: string, startAt?: number) => void
  onOpenSettings: () => void
}

/** The request being refined: the original ask plus follow-ups, and every video shown so far. */
interface Session {
  prompt: string
  refinements: string[]
  shown: string[]
}

const EXAMPLES = [
  'Calm lo-fi to study to, no vocals, at least an hour',
  'Beginner-friendly Rust tutorials that build a real project',
  'In-depth documentaries about the deep ocean, not clickbait',
  'Best live jazz sessions recorded in small clubs',
  'Quick healthy dinner recipes under 15 minutes',
  'What happened in AI this week, explained calmly',
]

const LENGTHS: { id: DiscoverLength; label: string; title: string }[] = [
  { id: 'any', label: 'Any length', title: 'No length filter' },
  { id: 'short', label: '< 4 min', title: 'Under 4 minutes' },
  { id: 'medium', label: '4-20 min', title: '4 to 20 minutes' },
  { id: 'long', label: '20+ min', title: 'Over 20 minutes' },
]

const RECENCIES: { id: DiscoverRecency; label: string }[] = [
  { id: 'any', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
]

function thumbOriginal(id: string): string {
  return 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg'
}

/** Your own YouTube algorithm: describe what you want, the model plans searches and ranks what comes back. */
export default function DiscoverTab({ settings, aiStatus, ytdlpReady, pushToast, onSettingsChange, onPlay, onOpenSettings }: Props): ReactNode {
  const [prompt, setPrompt] = useState('')
  const [avoid, setAvoid] = useState('')
  const [length, setLength] = useState<DiscoverLength>('any')
  const [recency, setRecency] = useState<DiscoverRecency>('any')
  const [session, setSession] = useState<Session | null>(null)
  const [result, setResult] = useState<DiscoverResult | null>(null)
  const [videos, setVideos] = useState<DiscoverVideo[]>([])
  const [running, setRunning] = useState<{ id: string; kind: 'new' | 'refine' | 'more' } | null>(null)
  const [refineText, setRefineText] = useState('')
  const [taste, setTaste] = useState<TasteProfile>({ liked: [], disliked: [], blockedChannels: [], recent: [] })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [insight, setInsight] = useState<DiscoverVideo | null>(null)
  const [showTaste, setShowTaste] = useState(false)
  const live = useAiLive(running?.id ?? null)
  const ready = !!aiStatus?.ready

  useEffect(() => {
    void unwrap(window.api.aiTaste()).then(setTaste).catch(() => undefined)
  }, [])

  const liked = useMemo(() => new Set(taste.liked.map((t) => t.id)), [taste.liked])
  const disliked = useMemo(() => new Set(taste.disliked.map((t) => t.id)), [taste.disliked])

  const updateTaste = useCallback(
    async (action: TasteAction) => {
      try {
        setTaste(await unwrap(window.api.aiTasteUpdate(action)))
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  const run = useCallback(
    async (next: Session, kind: 'new' | 'refine' | 'more') => {
      if (!ready) {
        onOpenSettings()
        return
      }
      if (running) void window.api.aiCancel(running.id)
      const id = newRequestId('disc')
      setRunning({ id, kind })
      try {
        const res = await unwrap(
          window.api.aiDiscover({
            requestId: id,
            prompt: next.prompt,
            refinements: next.refinements,
            exclude: kind === 'more' ? next.shown : [],
            length,
            recency,
            avoid,
            personalize: settings.aiPersonalize,
            useWeb: settings.aiUseWeb && !!aiStatus?.hasKey,
          }),
        )
        const merged = kind === 'more' ? [...videos, ...res.videos.filter((v) => !videos.some((x) => x.id === v.id))] : res.videos
        setResult(res)
        setVideos(merged)
        setSession({ ...next, shown: Array.from(new Set([...(kind === 'more' ? next.shown : []), ...merged.map((v) => v.id)])) })
        if (kind !== 'more') setSelected(new Set())
        if (!res.videos.length) pushToast('Nothing new matched. Try loosening the filters or rephrasing.', 'info')
        if (res.unranked && res.videos.length) pushToast('The model could not rank these, so they are in search order.', 'info')
        void unwrap(window.api.aiTaste()).then(setTaste).catch(() => undefined)
      } catch (err) {
        const message = errorMessage(err)
        if (message !== 'Canceled.') pushToast(message, 'error')
      } finally {
        setRunning((prev) => (prev?.id === id ? null : prev))
      }
    },
    [ready, running, length, recency, avoid, settings.aiPersonalize, settings.aiUseWeb, aiStatus?.hasKey, videos, pushToast, onOpenSettings],
  )

  const find = (text?: string): void => {
    const value = (text ?? prompt).trim()
    if (text !== undefined) setPrompt(text)
    if (!value) {
      pushToast('Describe what you want to watch, or use "For you".', 'info')
      return
    }
    setRefineText('')
    void run({ prompt: value, refinements: [], shown: [] }, 'new')
  }

  const forYou = (): void => {
    setRefineText('')
    void run({ prompt: '', refinements: [], shown: [] }, 'new')
  }

  const refine = (text?: string): void => {
    const value = (text ?? refineText).trim()
    if (!value || !session) return
    setRefineText('')
    void run({ ...session, refinements: [...session.refinements, value] }, 'refine')
  }

  const download = useCallback(
    async (list: DiscoverVideo[], mode: DownloadMode) => {
      if (!list.length) return
      try {
        const requests: DownloadRequest[] = list.map((v) => ({
          url: v.url,
          videoId: v.id,
          title: v.title,
          uploader: v.channel,
          thumbnail: thumbOriginal(v.id),
          duration: v.duration,
          mode,
        }))
        await unwrap(window.api.createJobs(requests))
        pushToast(requests.length + ' download(s) queued' + (mode === 'audio_only' ? ' as audio.' : '.'), 'success')
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  const vote = (video: DiscoverVideo, kind: 'like' | 'dislike'): void => {
    const current = kind === 'like' ? liked.has(video.id) : disliked.has(video.id)
    void updateTaste({ kind: current ? 'clear' : kind, item: { id: video.id, title: video.title, channel: video.channel, at: Date.now() } })
    if (kind === 'dislike' && !current) {
      setVideos((prev) => prev.filter((v) => v.id !== video.id))
      pushToast('Got it: fewer like "' + video.title.slice(0, 60) + '".', 'info')
    }
  }

  const blockChannel = (channel: string): void => {
    void updateTaste({ kind: 'block', channel })
    setVideos((prev) => prev.filter((v) => v.channel !== channel))
    pushToast(channel + ' will not be suggested again. Undo under "Your taste".', 'info')
  }

  const selectedVideos = videos.filter((v) => selected.has(v.id))

  if (!ready) {
    return (
      <div className="panel-scroll">
        <EmptyState
          icon={<Sparkles size={42} />}
          title="Your own YouTube algorithm"
          message="Describe what you want in plain words and an AI model plans the searches, then ranks every result for you, with a reason for each pick and none of YouTube's engagement bait. It also summarizes videos and sorts your library into playlists. Connect Ollama Cloud (or a local Ollama) to start."
        >
          <button type="button" className="btn primary" onClick={onOpenSettings}>
            <SettingsIcon size={15} />
            <span>{aiStatus && !aiStatus.model && (aiStatus.hasKey || !aiStatus.isCloud) ? 'Pick a model' : 'Set up AI'}</span>
          </button>
        </EmptyState>
      </div>
    )
  }

  const busy = !!running
  return (
    <div className="panel-scroll">
      <div className="card discover-hero">
        <div className="card-title">
          <Sparkles size={15} />
          <span>What do you want to watch?</span>
          <span className="chip" style={{ marginLeft: 'auto' }} title={aiStatus?.host}>{aiStatus?.model}</span>
        </div>
        <div className="input-row">
          <textarea
            className="input discover-input"
            rows={2}
            placeholder="e.g. honest reviews of budget mechanical keyboards from the last few months, no unboxings"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                find()
              }
            }}
          />
          <div className="discover-buttons">
            <button type="button" className="btn primary" disabled={busy || !ytdlpReady} onClick={() => find()}>
              {busy && running?.kind === 'new' && prompt.trim() ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
              <span>Find videos</span>
            </button>
            <button type="button" className="btn" disabled={busy || !ytdlpReady} onClick={forYou} title="Picks based on your library, favorites and feedback">
              <WandSparkles size={15} />
              <span>For you</span>
            </button>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="segmented">
            {LENGTHS.map((entry) => (
              <button key={entry.id} type="button" title={entry.title} className={length === entry.id ? 'active' : ''} onClick={() => setLength(entry.id)}>
                {entry.label}
              </button>
            ))}
          </div>
          <select className="select" style={{ width: 132 }} value={recency} onChange={(event) => setRecency(event.target.value as DiscoverRecency)}>
            {RECENCIES.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          <label className="check" title="Use your downloads, favorites and thumbs up/down as a taste profile">
            <input type="checkbox" checked={settings.aiPersonalize} onChange={(event) => void onSettingsChange({ aiPersonalize: event.target.checked })} />
            <span>Personalize</span>
          </label>
          <label className="check" title={aiStatus?.hasKey ? 'Look the request up with Ollama web search first: good for new releases and current events' : 'Needs an Ollama API key'}>
            <input type="checkbox" disabled={!aiStatus?.hasKey} checked={settings.aiUseWeb && !!aiStatus?.hasKey} onChange={(event) => void onSettingsChange({ aiUseWeb: event.target.checked })} />
            <span>Check the web first</span>
          </label>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Always avoid… (e.g. reaction videos, shorts, AI voiceovers)" value={avoid} onChange={(event) => setAvoid(event.target.value)} />
        </div>

        {!session && !busy ? (
          <div className="row tight" style={{ marginTop: 14 }}>
            <span className="hint">Try:</span>
            {(taste.recent.length ? taste.recent.slice(0, 4) : EXAMPLES.slice(0, 4)).map((example) => (
              <button key={example} type="button" className="chip chip-btn" onClick={() => find(example)}>{example}</button>
            ))}
          </div>
        ) : null}
      </div>

      {busy ? (
        <div className="card ai-progress">
          <span className="spinner" />
          <span className="grow">{live.stage ?? 'Starting…'}</span>
          <button type="button" className="btn small" onClick={() => running && void window.api.aiCancel(running.id)}>
            <Square size={12} />
            <span>Stop</span>
          </button>
        </div>
      ) : null}

      {result && session ? (
        <div className="card">
          <div className="discover-intent">
            <Sparkles size={15} />
            <span>{result.intent}</span>
          </div>
          {session.refinements.length ? (
            <div className="row tight" style={{ marginTop: 8 }}>
              <span className="hint">Refined:</span>
              {session.refinements.map((r, index) => (
                <span key={index} className="chip">{r}</span>
              ))}
              <button
                type="button"
                className="btn small ghost"
                disabled={busy}
                onClick={() => void run({ ...session, refinements: session.refinements.slice(0, -1) }, 'refine')}
                title="Drop the last refinement"
              >
                <Undo2 size={13} />
                <span>Undo</span>
              </button>
            </div>
          ) : null}
          <div className="row tight" style={{ marginTop: 10 }}>
            <span className="hint">Searched:</span>
            {result.queries.map((q) => (
              <span key={q.q} className="chip" title={q.found + ' results, sorted by ' + q.sort}>
                {q.q}
                {q.sort !== 'relevance' ? ' · ' + q.sort : ''}
              </span>
            ))}
          </div>
          {result.webSources.length ? (
            <div className="row tight" style={{ marginTop: 8 }}>
              <Globe size={13} style={{ color: 'var(--text-faint)' }} />
              {result.webSources.slice(0, 5).map((w) => (
                <a key={w.url} className="web-src" href={w.url} target="_blank" rel="noreferrer" title={w.url}>{w.title}</a>
              ))}
            </div>
          ) : null}
          <div className="hint" style={{ marginTop: 8 }}>
            {result.unranked ? 'In search order' : 'Ranked ' + videos.length + ' of ' + result.candidates + ' candidates'} by {result.model} in {(result.elapsedMs / 1000).toFixed(1)}s. Already downloaded videos and hidden channels are left out.
          </div>

          <div className="divider" />
          <div className="input-row">
            <WandSparkles size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
            <input
              className="input"
              placeholder="Refine: shorter, more advanced, only from the last year, no talking heads…"
              value={refineText}
              onChange={(event) => setRefineText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') refine()
              }}
            />
            <button type="button" className="btn" disabled={busy || !refineText.trim()} onClick={() => refine()}>Refine</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(session, 'more')} title="More videos for the same request, without repeats">
              <Plus size={15} />
              <span>More</span>
            </button>
          </div>
          <div className="row tight" style={{ marginTop: 10 }}>
            {['Shorter', 'More in-depth', 'More recent', 'Less mainstream', 'For beginners'].map((chip) => (
              <button key={chip} type="button" className="chip chip-btn" disabled={busy} onClick={() => refine(chip.toLowerCase())}>{chip}</button>
            ))}
          </div>
        </div>
      ) : null}

      {videos.length ? (
        <>
          <div className="row" style={{ margin: '18px 0 12px' }}>
            <button type="button" className="btn small" onClick={() => setSelected(selected.size === videos.length ? new Set() : new Set(videos.map((v) => v.id)))}>
              {selected.size === videos.length ? 'Select none' : 'Select all'}
            </button>
            <button type="button" className="btn small primary" disabled={!selectedVideos.length} onClick={() => void download(selectedVideos, 'video_audio')}>
              <Film size={14} />
              <span>Download {selectedVideos.length || ''} as video</span>
            </button>
            <button type="button" className="btn small" disabled={!selectedVideos.length} onClick={() => void download(selectedVideos, 'audio_only')}>
              <Music size={14} />
              <span>as audio</span>
            </button>
            <button type="button" className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={() => setShowTaste((v) => !v)}>
              <ThumbsUp size={13} />
              <span>Your taste ({taste.liked.length} up · {taste.disliked.length} down · {taste.blockedChannels.length} hidden)</span>
            </button>
          </div>

          {showTaste ? <TasteCard taste={taste} onUpdate={(action) => void updateTaste(action)} /> : null}

          <div className="library-grid">
            {videos.map((video) => {
              const isSelected = selected.has(video.id)
              return (
                <div key={video.id} className={'lib-card disc-card' + (isSelected ? ' selected' : '')} onDoubleClick={() => onPlay(video.url)} title="Double-click to play">
                  <div className="thumb">
                    {video.thumbnail ? <img src={video.thumbnail} alt="" loading="lazy" onError={hideBroken} /> : null}
                    {video.duration ? <span className="duration">{formatDuration(video.duration)}</span> : null}
                    {video.score !== null ? <span className={'match' + (video.score >= 80 ? ' high' : '')}>{video.score}% match</span> : null}
                    <label className="pick" onDoubleClick={(event) => event.stopPropagation()} title="Select">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(event) =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (event.target.checked) next.add(video.id)
                            else next.delete(video.id)
                            return next
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="lib-body">
                    <div className="lib-name" title={video.title}>{video.title}</div>
                    <div className="lib-meta">
                      {video.channel ? <span className="folder-tag" title={video.channel}>{video.channel}</span> : null}
                      {video.views !== null ? <span>{formatCount(video.views)} views</span> : null}
                    </div>
                    {video.reason ? (
                      <div className="reason" title={'Found by: ' + video.query}>
                        <Sparkles size={11} />
                        <span>{video.reason}</span>
                      </div>
                    ) : null}
                    <div className="lib-actions" onDoubleClick={(event) => event.stopPropagation()}>
                      <button type="button" className="btn small primary" onClick={() => onPlay(video.url)}>
                        <Play size={14} />
                        <span>Play</span>
                      </button>
                      <button type="button" className="btn small" title="AI summary" onClick={() => setInsight(video)}>
                        <FileText size={14} />
                      </button>
                      <button type="button" className={'btn small' + (liked.has(video.id) ? ' on' : '')} title="More like this" onClick={() => vote(video, 'like')}>
                        <ThumbsUp size={14} />
                      </button>
                      <button type="button" className={'btn small' + (disliked.has(video.id) ? ' on' : '')} title="Less like this" onClick={() => vote(video, 'dislike')}>
                        <ThumbsDown size={14} />
                      </button>
                      <MoreMenu
                        icon={<Ellipsis size={14} />}
                        className="btn small"
                        items={[
                          { label: 'Download video', icon: <Download size={14} />, onSelect: () => void download([video], 'video_audio') },
                          { label: 'Download audio only', icon: <Music size={14} />, onSelect: () => void download([video], 'audio_only') },
                          { label: 'Open on YouTube', icon: <ExternalLink size={14} />, onSelect: () => void window.open(video.url, '_blank') },
                          ...(video.channel ? [{ label: 'Never show ' + video.channel.slice(0, 28), icon: <Ban size={14} />, danger: true, onSelect: () => blockChannel(video.channel as string) }] : []),
                        ]}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : null}

      {!session && !busy ? (
        <div className="discover-how">
          <div className="how-step"><span>1</span><div><strong>Say it like you would to a friend.</strong> Mood, level, length, what to avoid. "For you" works from your library alone.</div></div>
          <div className="how-step"><span>2</span><div><strong>The model plans the searches</strong> with YouTube's own date, length and sort filters, and the app runs them.</div></div>
          <div className="how-step"><span>3</span><div><strong>Every result is ranked for you</strong> with a reason. Thumbs up/down and hidden channels teach it your taste.</div></div>
        </div>
      ) : null}

      {insight ? (
        <div className="overlay" onMouseDown={() => setInsight(null)}>
          <div className="overlay-inner insight-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="overlay-head">
              <div style={{ minWidth: 0 }}>
                <h2>{insight.title}</h2>
                <div className="sub">{insight.channel ?? ''}{insight.duration ? ' · ' + formatDuration(insight.duration) : ''}</div>
              </div>
              <div className="overlay-actions">
                <button type="button" className="btn small primary" onClick={() => { onPlay(insight.url); setInsight(null) }}>
                  <Play size={14} />
                  <span>Play</span>
                </button>
                <button type="button" className="btn small ghost" onClick={() => setInsight(null)} aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="overlay-body">
              <InsightPanel
                url={insight.url}
                aiReady={ready}
                autoSummarize
                onOpenSettings={onOpenSettings}
                pushToast={pushToast}
                onSeek={(seconds) => {
                  onPlay(insight.url, seconds)
                  setInsight(null)
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function TasteCard({ taste, onUpdate }: { taste: TasteProfile; onUpdate: (action: TasteAction) => void }): ReactNode {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title"><ThumbsUp size={15} /><span>Your taste</span></div>
      <div className="hint" style={{ marginBottom: 10 }}>Discover ranks with this (when Personalize is on) and never shows hidden channels. Click an item to forget it.</div>
      <div className="taste-grid">
        <div>
          <div className="pl-section" style={{ margin: '0 0 6px' }}>More like</div>
          {taste.liked.length ? taste.liked.slice(0, 30).map((t) => (
            <button key={t.id} type="button" className="chip chip-btn taste-chip" title="Forget" onClick={() => onUpdate({ kind: 'clear', item: t })}>{t.title}</button>
          )) : <span className="hint">Nothing yet</span>}
        </div>
        <div>
          <div className="pl-section" style={{ margin: '0 0 6px' }}>Less like</div>
          {taste.disliked.length ? taste.disliked.slice(0, 30).map((t) => (
            <button key={t.id} type="button" className="chip chip-btn taste-chip" title="Forget" onClick={() => onUpdate({ kind: 'clear', item: t })}>{t.title}</button>
          )) : <span className="hint">Nothing yet</span>}
        </div>
        <div>
          <div className="pl-section" style={{ margin: '0 0 6px' }}>Hidden channels</div>
          {taste.blockedChannels.length ? taste.blockedChannels.map((c) => (
            <button key={c} type="button" className="chip chip-btn taste-chip" title="Show again" onClick={() => onUpdate({ kind: 'unblock', channel: c })}>{c} ×</button>
          )) : <span className="hint">None</span>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn small danger" onClick={() => onUpdate({ kind: 'reset' })}>Reset taste</button>
      </div>
    </div>
  )
}
