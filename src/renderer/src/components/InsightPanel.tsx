import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FileText, Loader2, MessageCircleQuestionMark, Send, Settings as SettingsIcon, Sparkles, Square } from 'lucide-react'
import type { InsightSource } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { newRequestId, useAiLive } from '../lib/ai'
import type { ToastTone } from '../lib/types'
import RichText from './RichText'

interface Props {
  /** The YouTube video the insights are about. Changing it clears the panel. */
  url: string
  aiReady: boolean
  onOpenSettings: () => void
  pushToast: (message: string, tone?: ToastTone) => void
  /** Timestamps in answers become buttons that call this. */
  onSeek?: (seconds: number) => void
  /** Start summarizing as soon as the panel opens. */
  autoSummarize?: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const QUICK_QUESTIONS = ['What are the main takeaways?', 'Does it live up to its title?', 'Explain it like I am new to this', 'What should I skip?']

function sourceLabel(source: InsightSource): string {
  if (!source.language) return 'No captions: based on the description and chapters'
  return 'Based on ' + (source.autoCaptions ? 'automatic captions' : 'captions') + ' (' + source.language + ')'
}

/** AI summary of a video with clickable key moments, plus a chat to ask about it. */
export default function InsightPanel({ url, aiReady, onOpenSettings, pushToast, onSeek, autoSummarize }: Props): ReactNode {
  const [summary, setSummary] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState('')
  const [running, setRunning] = useState<{ kind: 'summary' | 'ask'; id: string } | null>(null)
  const [source, setSource] = useState<InsightSource | null>(null)
  const [model, setModel] = useState<string | null>(null)
  const live = useAiLive(running?.id ?? null)
  const chatEnd = useRef<HTMLDivElement | null>(null)
  const autoRan = useRef('')
  const runningId = useRef<string | null>(null)
  runningId.current = running?.id ?? null

  // Closing the panel stops whatever it was generating.
  useEffect(() => () => {
    if (runningId.current) void window.api.aiCancel(runningId.current)
  }, [])

  useEffect(() => {
    setSummary(null)
    setMessages([])
    setSource(null)
    setRunning((prev) => {
      if (prev) void window.api.aiCancel(prev.id)
      return null
    })
  }, [url])

  useEffect(() => {
    if (live.source) setSource(live.source)
  }, [live.source])

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length, live.text])

  const summarize = useCallback(async () => {
    const id = newRequestId('sum')
    setRunning({ kind: 'summary', id })
    setSummary(null)
    try {
      const result = await unwrap(window.api.aiSummarize({ requestId: id, url }))
      setSummary(result.text)
      setSource(result.source)
      setModel(result.model)
    } catch (err) {
      const message = errorMessage(err)
      if (message !== 'Canceled.') pushToast('Summary failed: ' + message, 'error')
    } finally {
      setRunning((prev) => (prev?.id === id ? null : prev))
    }
  }, [url, pushToast])

  useEffect(() => {
    if (!autoSummarize || !aiReady || autoRan.current === url) return
    autoRan.current = url
    void summarize()
  }, [autoSummarize, aiReady, url, summarize])

  const ask = useCallback(
    async (text?: string) => {
      const value = (text ?? question).trim()
      if (!value || running) return
      const id = newRequestId('ask')
      const history = messages.slice()
      if (summary) history.unshift({ role: 'assistant', content: summary })
      setMessages((prev) => [...prev, { role: 'user', content: value }])
      setQuestion('')
      setRunning({ kind: 'ask', id })
      try {
        const result = await unwrap(window.api.aiAsk({ requestId: id, url, question: value, history }))
        setMessages((prev) => [...prev, { role: 'assistant', content: result.text || '(no answer)' }])
        setSource(result.source)
        setModel(result.model)
      } catch (err) {
        const message = errorMessage(err)
        setMessages((prev) => [...prev, { role: 'assistant', content: message === 'Canceled.' ? 'Stopped.' : 'Could not answer: ' + message }])
      } finally {
        setRunning((prev) => (prev?.id === id ? null : prev))
      }
    },
    [question, running, messages, summary, url],
  )

  const stop = (): void => {
    if (running) void window.api.aiCancel(running.id)
  }

  if (!aiReady) {
    return (
      <div className="card ai-card">
        <div className="card-title"><Sparkles size={15} /><span>AI insights</span></div>
        <div className="row">
          <span className="hint grow">Summaries with clickable key moments and questions about any video. Connect Ollama (cloud or local) to turn this on.</span>
          <button type="button" className="btn small" onClick={onOpenSettings}>
            <SettingsIcon size={14} />
            <span>Set up AI</span>
          </button>
        </div>
      </div>
    )
  }

  const summaryText = running?.kind === 'summary' ? live.text : summary
  return (
    <div className="card ai-card">
      <div className="card-title">
        <Sparkles size={15} />
        <span>AI insights</span>
        {source ? <span className="hint" style={{ fontWeight: 400 }}>{sourceLabel(source)}</span> : null}
        {model ? <span className="chip" style={{ marginLeft: 'auto' }}>{model}</span> : null}
      </div>

      <div className="row tight">
        <button type="button" className="btn small primary" disabled={!!running} onClick={() => void summarize()}>
          {running?.kind === 'summary' ? <Loader2 size={14} className="spin" /> : <FileText size={14} />}
          <span>{summary ? 'Summarize again' : 'Summarize'}</span>
        </button>
        {QUICK_QUESTIONS.map((q) => (
          <button key={q} type="button" className="btn small ghost" disabled={!!running} onClick={() => void ask(q)}>
            {q}
          </button>
        ))}
      </div>

      {running && !live.text ? (
        <div className="loading-row">
          <span className="spinner" />
          <span>{live.stage ?? 'Starting…'}</span>
        </div>
      ) : null}

      {summaryText ? (
        <div className="ai-summary">
          <RichText text={summaryText} onSeek={onSeek} streaming={running?.kind === 'summary'} />
        </div>
      ) : null}

      {messages.length || running?.kind === 'ask' ? (
        <div className="ai-chat">
          {messages.map((m, index) =>
            m.role === 'user' ? (
              <div key={index} className="bubble user">{m.content}</div>
            ) : (
              <div key={index} className="bubble assistant"><RichText text={m.content} onSeek={onSeek} /></div>
            ),
          )}
          {running?.kind === 'ask' && live.text ? (
            <div className="bubble assistant"><RichText text={live.text} onSeek={onSeek} streaming /></div>
          ) : null}
          <div ref={chatEnd} />
        </div>
      ) : null}

      <div className="input-row" style={{ marginTop: 12 }}>
        <MessageCircleQuestionMark size={16} style={{ color: 'var(--text-faint)', flex: 'none' }} />
        <input
          className="input"
          placeholder="Ask anything about this video…"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void ask()
          }}
        />
        {running ? (
          <button type="button" className="btn" onClick={stop}>
            <Square size={13} />
            <span>Stop</span>
          </button>
        ) : (
          <button type="button" className="btn" disabled={!question.trim()} onClick={() => void ask()}>
            <Send size={14} />
            <span>Ask</span>
          </button>
        )}
      </div>
    </div>
  )
}
