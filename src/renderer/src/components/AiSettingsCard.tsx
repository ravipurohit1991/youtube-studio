import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { CheckCheck, ExternalLink, KeyRound, Loader2, Plug, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react'
import type { AiModel, AiStatus, AiTestResult, Settings } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes } from '../lib/format'
import type { ToastTone } from '../lib/types'

interface Props {
  status: AiStatus | null
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
  onStatus: (status: AiStatus) => void
  pushToast: (message: string, tone?: ToastTone) => void
}

const CLOUD_HOST = 'https://ollama.com'
const LOCAL_HOST = 'http://localhost:11434'
/** Picked automatically when no model is chosen yet: strong general models first. */
const PREFERRED = ['gpt-oss:120b', 'qwen3-next', 'deepseek-v3', 'kimi-k2', 'glm-4', 'qwen3', 'gpt-oss:20b', 'gpt-oss', 'llama']

export function preferredModel(models: AiModel[]): string | null {
  for (const hint of PREFERRED) {
    const hit = models.find((m) => m.name.startsWith(hint))
    if (hit) return hit.name
  }
  return models[0]?.name ?? null
}

function modelLabel(m: AiModel): string {
  const extra = [m.parameterSize, m.size ? formatBytes(m.size) : null].filter(Boolean).join(', ')
  return m.name + (extra ? '  (' + extra + ')' : '')
}

export default function AiSettingsCard({ status, settings, onSettingsChange, onStatus, pushToast }: Props): ReactNode {
  const [host, setHost] = useState(settings.aiHost)
  const [keyInput, setKeyInput] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [models, setModels] = useState<AiModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<AiTestResult | null>(null)

  useEffect(() => setHost(settings.aiHost), [settings.aiHost])

  const refreshStatus = useCallback(async (): Promise<AiStatus | null> => {
    try {
      const next = await unwrap(window.api.aiStatus())
      onStatus(next)
      return next
    } catch {
      return null
    }
  }, [onStatus])

  const loadModels = useCallback(
    async (quiet = false) => {
      setLoadingModels(true)
      setModelsError(null)
      try {
        const list = await unwrap(window.api.aiListModels())
        setModels(list)
        if (!list.length) setModelsError('The server lists no models.' + (status?.isCloud ? '' : ' Pull one first, e.g. "ollama pull gpt-oss:20b".'))
        if (list.length && (!settings.aiModel || !list.some((m) => m.name === settings.aiModel))) {
          const pick = preferredModel(list)
          if (pick && !settings.aiModel) {
            await onSettingsChange({ aiModel: pick })
            await refreshStatus()
            if (!quiet) pushToast('Model set to ' + pick + '. Change it any time.', 'success')
          }
        }
      } catch (err) {
        setModels([])
        setModelsError(errorMessage(err))
      } finally {
        setLoadingModels(false)
      }
    },
    [settings.aiModel, status?.isCloud, onSettingsChange, refreshStatus, pushToast],
  )

  const canList = !!status && (status.hasKey || !status.isCloud)
  useEffect(() => {
    if (canList) void loadModels(true)
    // Reload when the server or key changes, not on every model pick.
  }, [canList, status?.host, status?.keyHint])

  const saveKey = async (): Promise<void> => {
    try {
      const next = await unwrap(window.api.aiSetKey(keyInput))
      onStatus(next)
      setKeyInput('')
      setReplacing(false)
      setTest(null)
      pushToast('API key saved' + (next.encrypted ? ' (encrypted with your OS keychain).' : '.'), 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const removeKey = async (): Promise<void> => {
    try {
      onStatus(await unwrap(window.api.aiClearKey()))
      setModels([])
      setTest(null)
      pushToast('API key removed.', 'info')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const saveHost = async (value: string): Promise<void> => {
    setHost(value)
    await onSettingsChange({ aiHost: value.trim() || CLOUD_HOST })
    setModels([])
    setTest(null)
    await refreshStatus()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    try {
      setTest(await unwrap(window.api.aiTest()))
    } catch (err) {
      pushToast('Connection test failed: ' + errorMessage(err), 'error')
    } finally {
      setTesting(false)
    }
  }

  const isCloud = status?.isCloud ?? true
  return (
    <div className="card" id="ai-settings">
      <div className="card-title">
        <Sparkles size={15} />
        <span>AI (Ollama)</span>
        {status ? (
          <span className={'chip ' + (status.ready ? 'ok' : 'warn')} style={{ marginLeft: 'auto' }}>
            {status.ready ? 'ready · ' + status.model : status.isCloud && !status.hasKey ? 'needs an API key' : 'pick a model'}
          </span>
        ) : null}
      </div>
      <div className="hint" style={{ marginBottom: 14 }}>
        Powers Discover (your own recommendation algorithm), video summaries and questions, and smart playlists. Works with your
        Ollama Cloud subscription or a local Ollama.
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor="ai-host">Server</label>
          <div className="input-row">
            <input
              id="ai-host"
              className="input mono"
              value={host}
              spellCheck={false}
              onChange={(event) => setHost(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveHost(host)
              }}
            />
            <button type="button" className="btn" title="Save" onClick={() => void saveHost(host)}>
              <Save size={15} />
            </button>
          </div>
          <div className="row tight">
            <button type="button" className={'btn small' + (isCloud ? ' on' : '')} onClick={() => void saveHost(CLOUD_HOST)}>Ollama Cloud</button>
            <button type="button" className={'btn small' + (!isCloud && host.includes('11434') ? ' on' : '')} onClick={() => void saveHost(LOCAL_HOST)}>Local Ollama</button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ai-key">API key {isCloud ? '' : '(optional for a local server; also used for web search)'}</label>
          {status?.hasKey && !replacing ? (
            <div className="row tight">
              <span className="chip ok">
                <KeyRound size={12} />
                saved ····{status.keyHint}
              </span>
              <span className="hint">{status.encrypted ? 'encrypted with your OS keychain' : 'stored in the app data folder'}</span>
              <button type="button" className="btn small" onClick={() => setReplacing(true)}>Replace</button>
              <button type="button" className="btn small danger" onClick={() => void removeKey()}>
                <Trash2 size={13} />
                <span>Remove</span>
              </button>
            </div>
          ) : (
            <div className="input-row">
              <input
                id="ai-key"
                className="input mono"
                type="password"
                autoComplete="off"
                placeholder="Paste your Ollama API key"
                value={keyInput}
                spellCheck={false}
                onChange={(event) => setKeyInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && keyInput.trim()) void saveKey()
                }}
              />
              <button type="button" className="btn primary" disabled={!keyInput.trim()} onClick={() => void saveKey()}>
                <KeyRound size={15} />
                <span>Save key</span>
              </button>
              {replacing ? <button type="button" className="btn ghost" onClick={() => setReplacing(false)}>Cancel</button> : null}
            </div>
          )}
          <span className="hint">
            Create one at{' '}
            <a className="web-src" href="https://ollama.com/settings/keys" target="_blank" rel="noreferrer">
              ollama.com/settings/keys <ExternalLink size={10} />
            </a>
            . It stays in the app's main process and is only sent to your AI server (never over plain HTTP to another machine) and to Ollama web search.
          </span>
        </div>
      </div>

      <div className="divider" />

      <div className="field">
        <label htmlFor="ai-model">Model</label>
        <div className="input-row">
          <select
            id="ai-model"
            className="select"
            value={settings.aiModel}
            disabled={!models.length && !settings.aiModel}
            onChange={async (event) => {
              await onSettingsChange({ aiModel: event.target.value })
              setTest(null)
              await refreshStatus()
            }}
          >
            {!settings.aiModel ? <option value="">{canList ? 'Choose a model…' : isCloud ? 'Save your API key first' : 'Load the model list'}</option> : null}
            {settings.aiModel && !models.some((m) => m.name === settings.aiModel) ? <option value={settings.aiModel}>{settings.aiModel}</option> : null}
            {models.map((m) => (
              <option key={m.name} value={m.name}>{modelLabel(m)}</option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!canList || loadingModels} onClick={() => void loadModels()}>
            {loadingModels ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
            <span>Refresh list</span>
          </button>
          <button type="button" className="btn" disabled={!status?.ready || testing} onClick={() => void runTest()}>
            {testing ? <Loader2 size={15} className="spin" /> : <Plug size={15} />}
            <span>Test</span>
          </button>
        </div>
        {modelsError ? <span className="hint" style={{ color: 'var(--err)' }}>{modelsError}</span> : null}
        {test ? (
          <span className="hint" style={{ color: 'var(--ok)' }}>
            <CheckCheck size={12} style={{ verticalAlign: -2 }} /> {test.model} answered in {(test.latencyMs / 1000).toFixed(1)}s: “{test.reply}”
          </span>
        ) : (
          <span className="hint">
            Bigger models rank and summarize better; smaller ones answer faster. {models.length ? models.length + ' available.' : ''}
          </span>
        )}
      </div>

      <div className="divider" />
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={settings.aiPersonalize} onChange={(event) => void onSettingsChange({ aiPersonalize: event.target.checked })} />
          <span>Personalize Discover with my library and feedback</span>
        </label>
        <label className="check">
          <input type="checkbox" disabled={!status?.hasKey} checked={settings.aiUseWeb} onChange={(event) => void onSettingsChange({ aiUseWeb: event.target.checked })} />
          <span>Check the web before searching (Ollama web search)</span>
        </label>
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        What is sent to the server: your request, video titles and channels from search results and (when personalizing) from your
        library, and the captions of videos you summarize. Nothing is sent until you use an AI feature.
      </div>
    </div>
  )
}
