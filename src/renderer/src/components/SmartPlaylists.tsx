import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ListPlus, RefreshCw, Sparkles, X } from 'lucide-react'
import type { LibraryItem, OrganizeResult } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { newRequestId, useAiLive } from '../lib/ai'
import type { ToastTone } from '../lib/types'

interface Props {
  items: LibraryItem[]
  pushToast: (message: string, tone?: ToastTone) => void
  onClose: () => void
}

/** Let the model sort the library into themed playlists; nothing is created until you confirm. */
export default function SmartPlaylists({ items, pushToast, onClose }: Props): ReactNode {
  const [requestId, setRequestId] = useState<string | null>(null)
  const [result, setResult] = useState<OrganizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const live = useAiLive(requestId)
  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  const start = useCallback(async () => {
    const id = newRequestId('org')
    setRequestId(id)
    setResult(null)
    setError(null)
    try {
      const res = await unwrap(window.api.aiOrganize(id))
      setResult(res)
      setChosen(new Set(res.groups.map((_, index) => index)))
    } catch (err) {
      const message = errorMessage(err)
      if (message !== 'Canceled.') setError(message)
    } finally {
      setRequestId((prev) => (prev === id ? null : prev))
    }
  }, [])

  useEffect(() => {
    void start()
  }, [start])

  const close = (): void => {
    if (requestId) void window.api.aiCancel(requestId)
    onClose()
  }

  const create = async (): Promise<void> => {
    if (!result) return
    setCreating(true)
    let made = 0
    try {
      for (const [index, group] of result.groups.entries()) {
        if (!chosen.has(index)) continue
        await unwrap(window.api.createPlaylist(group.name, group.keys))
        made += 1
      }
      pushToast(made + ' playlist(s) created.', 'success')
      onClose()
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal smart-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <h3 style={{ margin: 0 }}>Smart playlists</h3>
          <button type="button" className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={close} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        {requestId ? (
          <div className="loading-row">
            <span className="spinner" />
            <span>{live.stage ?? 'Starting…'}</span>
          </div>
        ) : null}

        {error ? (
          <>
            <p className="hint" style={{ color: 'var(--err)', fontSize: 13 }}>{error}</p>
            <button type="button" className="btn small" onClick={() => void start()}>
              <RefreshCw size={14} />
              <span>Try again</span>
            </button>
          </>
        ) : null}

        {result ? (
          <>
            <div className="hint" style={{ marginBottom: 10 }}>
              {result.model} grouped {result.considered} items. Pick the playlists to create; you can rename or edit them afterwards.
            </div>
            <div className="modal-list">
              {result.groups.map((group, index) => (
                <label key={index} className="smart-group">
                  <input
                    type="checkbox"
                    checked={chosen.has(index)}
                    onChange={(event) =>
                      setChosen((prev) => {
                        const next = new Set(prev)
                        if (event.target.checked) next.add(index)
                        else next.delete(index)
                        return next
                      })
                    }
                  />
                  <span className="pl-text">
                    <span className="pl-name">{group.name} <span className="pl-meta">· {group.keys.length} items</span></span>
                    {group.description ? <span className="pl-meta">{group.description}</span> : null}
                    <span className="smart-items">
                      {group.keys
                        .slice(0, 4)
                        .map((key) => byKey.get(key)?.title ?? byKey.get(key)?.name ?? key)
                        .join(' · ')}
                      {group.keys.length > 4 ? ' …' : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="row tight" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => void start()} disabled={creating}>
                <RefreshCw size={14} />
                <span>Regroup</span>
              </button>
              <button type="button" className="btn primary" disabled={!chosen.size || creating} onClick={() => void create()}>
                <ListPlus size={15} />
                <span>{creating ? 'Creating…' : 'Create ' + chosen.size + ' playlist(s)'}</span>
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
