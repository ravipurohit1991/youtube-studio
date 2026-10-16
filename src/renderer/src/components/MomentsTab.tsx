import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  BrainCircuit,
  FileDown,
  Loader2,
  MessageSquareQuote,
  Music,
  Play,
  Search,
  Send,
  Settings as SettingsIcon,
  Sparkles,
  Square,
  StickyNote,
  TextSearch,
  Video,
  X,
} from 'lucide-react'
import type { AiStatus, LibraryItem, LibrarySource, Moment, TranscriptIndexStatus, TranscriptSearchResult } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { newRequestId, useAiLive } from '../lib/ai'
import { formatDuration, ytThumb } from '../lib/format'
import { usePref } from '../lib/prefs'
import type { PushToast } from '../lib/types'
import { EmptyState, ProgressBar, hideBroken } from './common'
import MomentRow from './MomentRow'
import RichText from './RichText'
import { Highlight } from './TranscriptView'

interface Props {
  library: LibraryItem[]
  moments: Moment[]
  status: TranscriptIndexStatus | null
  aiStatus: AiStatus | null
  pushToast: PushToast
  /** Play a library item from this second. */
  onPlayAt: (key: string, at: number) => void
  onOpenMoment: (moment: Moment) => void
  onOpenAiSettings: () => void
  /** A search (or question) started from elsewhere, e.g. the command palette. */
  query: { text: string; nonce: number; mode?: Mode } | null
}

type Mode = 'search' | 'ask'

interface Turn {
  question: string
  answer: string
  sources: LibrarySource[]
}

const EXAMPLES = ['"machine learning"', 'recipe garlic', 'chorus', 'docker compose']
const ASK_EXAMPLES = ['What did they recommend for beginners?', 'Which videos explain how to fix it?', 'Summarize what my videos say about sleep']

function Thumb({ item, videoId }: { item: LibraryItem | undefined; videoId: string | null }): ReactNode {
  const src = item?.thumbnailUrl ?? ytThumb(videoId)
  return (
    <span className="hit-thumb">
      {src ? <img src={src} alt="" loading="lazy" onError={hideBroken} /> : item?.kind === 'audio' ? <Music size={18} /> : <Video size={18} />}
    </span>
  )
}

/**
 * Moments: search what is said across everything you saved, ask your library a question (AI, with
 * citations that play the exact second), and the moments you bookmarked, with notes.
 */
export default function MomentsTab({ library, moments, status, aiStatus, pushToast, onPlayAt, onOpenMoment, onOpenAiSettings, query }: Props): ReactNode {
  const [mode, setMode] = usePref<Mode>('moments.mode', 'search')
  const [text, setText] = useState('')
  const [result, setResult] = useState<TranscriptSearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [asking, setAsking] = useState<{ id: string; question: string } | null>(null)
  const [liveSources, setLiveSources] = useState<LibrarySource[]>([])
  const [momentFilter, setMomentFilter] = useState('')
  const live = useAiLive(asking?.id ?? null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const searchSeq = useRef(0)
  const handled = useRef(0)
  const byKey = useMemo(() => new Map(library.map((item) => [item.key, item])), [library])

  const search = useCallback(async (value: string) => {
    const q = value.trim()
    const seq = ++searchSeq.current
    if (q.length < 2) {
      setResult(null)
      setSearching(false)
      return
    }
    setSearching(true)
    try {
      const found = await unwrap(window.api.transcriptSearch(q, 60))
      if (seq === searchSeq.current) setResult(found)
    } catch (err) {
      if (seq === searchSeq.current) pushToast(errorMessage(err), 'error')
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }, [pushToast])

  // Search as you type.
  useEffect(() => {
    if (mode !== 'search') return undefined
    const timer = window.setTimeout(() => void search(text), 220)
    return () => window.clearTimeout(timer)
  }, [text, mode, search])

  // New transcripts arrived: refresh the results.
  useEffect(() => {
    if (mode === 'search' && text.trim().length >= 2) void search(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.indexed])

  useEffect(() => {
    if (!query || handled.current === query.nonce) return
    handled.current = query.nonce
    setMode(query.mode ?? 'search')
    setText(query.text)
    window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [query, setMode])

  useEffect(() => {
    if (live.sources) setLiveSources(live.sources)
  }, [live.sources])

  const ask = useCallback(async (value?: string) => {
    const question = (value ?? text).trim()
    if (!question || asking) return
    if (!aiStatus?.ready) {
      onOpenAiSettings()
      return
    }
    const id = newRequestId('lib')
    const history = turns.slice(-3).flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.answer },
    ])
    setAsking({ id, question })
    setLiveSources([])
    setText('')
    try {
      const answer = await unwrap(window.api.aiAskLibrary({ requestId: id, question, history }))
      setTurns((prev) => [...prev, { question, answer: answer.text || '(no answer)', sources: answer.sources }])
    } catch (err) {
      const message = errorMessage(err)
      setTurns((prev) => [...prev, { question, answer: message === 'Canceled.' ? 'Stopped.' : 'Could not answer: ' + message, sources: [] }])
    } finally {
      setAsking((prev) => (prev?.id === id ? null : prev))
    }
  }, [text, asking, aiStatus?.ready, turns, onOpenAiSettings])

  const index = async (): Promise<void> => {
    try {
      const next = await unwrap(window.api.transcriptIndex())
      if (!next.running && !next.pending) pushToast('Everything that has captions is already searchable.', 'info')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const exportAll = async (): Promise<void> => {
    try {
      const path = await unwrap(window.api.momentsExport())
      if (path) pushToast('Moments exported.', 'success', { actions: [{ label: 'Show in folder', onClick: () => void window.api.revealPath(path) }] })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const groups = useMemo(() => {
    const words = momentFilter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = moments.filter((m) => !words.length || words.every((w) => (m.title + ' ' + m.note + ' ' + (m.channel ?? '')).toLowerCase().includes(w)))
    const map = new Map<string, Moment[]>()
    list.forEach((m) => {
      const id = m.key ?? m.videoId ?? m.url ?? m.title
      map.set(id, [...(map.get(id) ?? []), m])
    })
    return Array.from(map.values())
      .map((group) => group.slice().sort((a, b) => a.at - b.at))
      .sort((a, b) => Math.max(...b.map((m) => m.createdAt)) - Math.max(...a.map((m) => m.createdAt)))
  }, [moments, momentFilter])

  const citeTitle = (sources: LibrarySource[]) => (ref: string): string | null => sources.find((s) => s.ref === ref)?.title ?? null
  const onCite = (sources: LibrarySource[]) => (ref: string, seconds: number | null): void => {
    const source = sources.find((s) => s.ref === ref)
    if (source) onPlayAt(source.key, seconds ?? source.start)
  }

  const indexing = !!status?.running
  const searchable = status ? status.indexed : 0
  const aiReady = !!aiStatus?.ready

  return (
    <div className="panel-scroll">
      <div className="panel-narrow">
        <section className="card moments-hero">
          <div className="segmented" style={{ marginBottom: 14 }}>
            <button type="button" className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
              <TextSearch size={13} />Search what was said
            </button>
            <button type="button" className={mode === 'ask' ? 'active' : ''} onClick={() => setMode('ask')}>
              <BrainCircuit size={13} />Ask your library
            </button>
          </div>
          <form
            className="link-bar"
            onSubmit={(event) => {
              event.preventDefault()
              if (mode === 'ask') void ask()
              else void search(text)
            }}
          >
            {mode === 'search' ? <Search size={18} /> : <Sparkles size={18} />}
            <input
              ref={inputRef}
              aria-label={mode === 'search' ? 'Search inside your videos' : 'Ask your library'}
              placeholder={mode === 'search' ? 'Find any word said in your downloads…  e.g. "neural network"' : 'Ask a question; the answer cites the exact moments…'}
              value={text}
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
            />
            {text ? (
              <button type="button" className="icon-btn" title="Clear" onClick={() => { setText(''); setResult(null) }}>
                <X size={16} />
              </button>
            ) : null}
            {mode === 'ask' ? (
              asking ? (
                <button type="button" className="btn" onClick={() => void window.api.aiCancel(asking.id)}>
                  <Square size={13} />
                  <span>Stop</span>
                </button>
              ) : (
                <button type="submit" className="btn gradient" disabled={!text.trim()}>
                  <Send size={15} />
                  <span>Ask</span>
                </button>
              )
            ) : searching ? <Loader2 size={16} className="spin" style={{ color: 'var(--text-faint)' }} /> : null}
          </form>

          <div className="index-row">
            {indexing && status ? (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="hint" style={{ marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    Reading captions {status.done} of {status.queued}{status.current ? ': ' + status.current : ''}
                  </div>
                  <ProgressBar value={status.queued ? (status.done / status.queued) * 100 : 0} status="downloading" />
                </div>
                <button type="button" className="btn small" onClick={() => void window.api.transcriptCancel()}>
                  <Square size={12} />
                  <span>Stop</span>
                </button>
              </>
            ) : (
              <>
                <span className="hint grow">
                  {status
                    ? searchable + ' of ' + status.total + ' item(s) searchable' + (status.missing ? ' · ' + status.missing + ' without captions' : '') + (status.pending ? ' · ' + status.pending + ' not read yet' : '')
                    : 'Checking your library…'}
                </span>
                {status && status.pending > 0 ? (
                  <button type="button" className="btn small primary" onClick={() => void index()}>
                    <TextSearch size={14} />
                    <span>Make my library searchable</span>
                  </button>
                ) : null}
              </>
            )}
          </div>
        </section>

        {mode === 'search' ? (
          result && result.terms.length ? (
            result.matches.length ? (
              <section className="stack" style={{ gap: 12 }}>
                <div className="hint">
                  {result.totalHits} mention(s) in {result.matches.length} {result.matches.length === 1 ? 'item' : 'items'} · searched {result.searched} transcript(s) in {result.elapsedMs} ms
                </div>
                {result.matches.map((match) => {
                  const item = byKey.get(match.key)
                  return (
                    <div key={match.key} className="card hit-card">
                      <div className="hit-head">
                        <Thumb item={item} videoId={match.videoId} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="lib-name" title={match.title}>{match.title}</div>
                          <div className="lib-meta">
                            {item?.uploader ? <span>{item.uploader}</span> : null}
                            {item?.duration ? <span>{formatDuration(item.duration)}</span> : null}
                            <span>{match.total === 1 ? '1 mention' : match.total + ' mentions'}</span>
                          </div>
                        </div>
                        <button type="button" className="btn small" title="Play from the first mention" onClick={() => onPlayAt(match.key, Math.max(0, (match.hits[0]?.start ?? 0) - 1))}>
                          <Play size={13} />
                          <span>Play</span>
                        </button>
                      </div>
                      <div className="hit-lines">
                        {match.hits.map((hit) => (
                          <button key={hit.start} type="button" className="tline" onClick={() => onPlayAt(match.key, Math.max(0, hit.start - 1))}>
                            <span className="tline-time">{formatDuration(hit.start)}</span>
                            <span className="tline-text"><Highlight text={hit.text} terms={result.terms} /></span>
                          </button>
                        ))}
                        {match.total > match.hits.length ? <div className="hint" style={{ padding: '4px 8px' }}>and {match.total - match.hits.length} more in this one: open it and use the transcript filter.</div> : null}
                      </div>
                    </div>
                  )
                })}
              </section>
            ) : (
              <EmptyState
                icon={<TextSearch size={30} />}
                title={'Nobody says "' + text.trim() + '"'}
                message={searchable ? 'Not in any of your ' + searchable + ' searchable item(s). Try another word, or fewer words.' : 'Nothing is searchable yet: click "Make my library searchable" above first.'}
              />
            )
          ) : (
            <div className="discover-how">
              <div className="how-step">
                <span>1</span>
                <div><strong>Every word, every video.</strong> The app reads the captions of what you download (or the subtitle files next to them) and keeps them on this computer.</div>
              </div>
              <div className="how-step">
                <span>2</span>
                <div><strong>Search like Ctrl+F.</strong> Words find every place they are said; "quotes" find an exact phrase. Try {EXAMPLES.map((e, i) => <button key={e} type="button" className="link-btn" onClick={() => setText(e)}>{e + (i < EXAMPLES.length - 1 ? ',' : '')}</button>)}</div>
              </div>
              <div className="how-step">
                <span>3</span>
                <div><strong>Jump right there.</strong> Click a line and the video plays from that second. The player shows the transcript as it plays, too.</div>
              </div>
            </div>
          )
        ) : null}

        {mode === 'ask' ? (
          <section className="stack" style={{ gap: 12 }}>
            {!aiReady ? (
              <div className="card ai-card">
                <div className="row">
                  <span className="hint grow">Ask questions across everything you saved: the answer quotes your videos and every citation plays that exact moment. Connect Ollama (cloud or local) to turn this on.</span>
                  <button type="button" className="btn small" onClick={onOpenAiSettings}>
                    <SettingsIcon size={14} />
                    <span>Set up AI</span>
                  </button>
                </div>
              </div>
            ) : null}
            {turns.map((turn, i) => (
              <div key={i} className="card ai-card qa-turn">
                <div className="bubble user" style={{ marginLeft: 'auto' }}>{turn.question}</div>
                <div className="ai-summary">
                  <RichText text={turn.answer} onCite={onCite(turn.sources)} citeTitle={citeTitle(turn.sources)} />
                </div>
                {turn.sources.length ? <Sources sources={turn.sources} onPlayAt={onPlayAt} /> : null}
              </div>
            ))}
            {asking ? (
              <div className="card ai-card qa-turn">
                <div className="bubble user" style={{ marginLeft: 'auto' }}>{asking.question}</div>
                {live.text ? (
                  <div className="ai-summary">
                    <RichText text={live.text} streaming onCite={onCite(liveSources)} citeTitle={citeTitle(liveSources)} />
                  </div>
                ) : (
                  <div className="loading-row">
                    <span className="spinner" />
                    <span>{live.stage ?? 'Starting…'}</span>
                  </div>
                )}
                {liveSources.length ? <Sources sources={liveSources} onPlayAt={onPlayAt} /> : null}
              </div>
            ) : null}
            {!turns.length && !asking && aiReady ? (
              <div className="card">
                <div className="card-title"><MessageSquareQuote size={15} /><span>Your videos, answering</span></div>
                <p className="hint" style={{ margin: '0 0 12px', lineHeight: 1.55 }}>
                  The app finds the passages of your {searchable || ''} searchable item(s) that talk about your question and the model answers from them, citing each moment. Works with any Ollama model; nothing but those passages is sent.
                </p>
                <div className="row tight">
                  {ASK_EXAMPLES.map((q) => (
                    <button key={q} type="button" className="btn small ghost" onClick={() => void ask(q)} disabled={!searchable}>{q}</button>
                  ))}
                </div>
              </div>
            ) : null}
            {turns.length && !asking ? (
              <div className="row">
                <button type="button" className="btn small ghost" onClick={() => setTurns([])}>Start over</button>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="shelf" style={{ marginTop: 26 }}>
          <div className="shelf-head">
            <StickyNote size={16} style={{ color: 'var(--accent)' }} />
            <span className="shelf-title">Saved moments</span>
            <span className="stat">{moments.length}</span>
            {moments.length ? (
              <div className="row tight" style={{ marginLeft: 'auto' }}>
                <div className="search-wrap" style={{ width: 220 }}>
                  <Search size={13} />
                  <input className="input" placeholder="Filter notes and titles…" value={momentFilter} onChange={(event) => setMomentFilter(event.target.value)} />
                </div>
                <button type="button" className="btn small" onClick={() => void exportAll()} title="Save all moments as a Markdown file with links">
                  <FileDown size={14} />
                  <span>Export</span>
                </button>
              </div>
            ) : null}
          </div>
          {groups.length ? (
            <div className="moment-groups">
              {groups.map((group) => {
                const first = group[0]
                const item = first.key ? byKey.get(first.key) : undefined
                return (
                  <div key={first.id} className="card moment-group">
                    <div className="hit-head">
                      <Thumb item={item} videoId={first.videoId} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="lib-name" title={first.title}>{first.title}</div>
                        <div className="lib-meta">
                          {first.channel ? <span>{first.channel}</span> : null}
                          <span>{item ? 'in your library' : first.url ? 'streams from YouTube' : 'file is gone'}</span>
                        </div>
                      </div>
                    </div>
                    <div className="moment-list">
                      {group.map((m) => (
                        <MomentRow key={m.id} moment={m} onOpen={onOpenMoment} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : moments.length ? (
            <div className="hint">No moment matches "{momentFilter}".</div>
          ) : (
            <EmptyState
              icon={<StickyNote size={30} />}
              title="Bookmark the good parts"
              message="Press B while a video plays (in the player or the Stream tab) to save that moment, then add a note. They show up here, on the map under the video, and export as Markdown with links to the exact second."
            />
          )}
        </section>
      </div>
    </div>
  )
}

function Sources({ sources, onPlayAt }: { sources: LibrarySource[]; onPlayAt: (key: string, at: number) => void }): ReactNode {
  return (
    <div className="qa-sources">
      <span className="hint">Based on:</span>
      {sources.map((s) => (
        <button key={s.ref} type="button" className="chip chip-btn" title={'Play "' + s.title + '" at ' + formatDuration(s.start)} onClick={() => onPlayAt(s.key, s.start)}>
          <strong>{s.ref}</strong> {s.title.length > 42 ? s.title.slice(0, 40) + '…' : s.title} · {formatDuration(s.start)}
        </button>
      ))}
    </div>
  )
}
