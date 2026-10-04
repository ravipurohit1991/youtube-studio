import { useMemo, useState, type ReactNode } from 'react'
import {
  FolderOpen,
  Library as LibraryIcon,
  MonitorPlay,
  Music,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Video,
} from 'lucide-react'
import type { LibraryItem, Settings } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatDuration, humanDate } from '../lib/format'
import type { ToastTone } from '../lib/types'
import { EmptyState } from './common'

interface Props {
  items: LibraryItem[]
  busy: boolean
  settings: Settings
  pushToast: (message: string, tone?: ToastTone) => void
  onRescan: () => void
  onPlay: (item: LibraryItem, list: LibraryItem[], index: number) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
}

type KindFilter = 'all' | 'video' | 'audio'
type SortKey = 'newest' | 'name' | 'size' | 'duration'

export default function LibraryTab({ items, busy, settings, pushToast, onRescan, onPlay }: Props): ReactNode {
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = items
    if (kind !== 'all') list = list.filter((item) => item.kind === kind)
    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter((item) => {
        const haystack = ((item.title ?? '') + ' ' + item.name + ' ' + (item.uploader ?? '')).toLowerCase()
        return haystack.includes(query)
      })
    }
    const sorted = list.slice()
    if (sort === 'newest') sorted.sort((a, b) => b.mtime - a.mtime)
    if (sort === 'name') sorted.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name))
    if (sort === 'size') sorted.sort((a, b) => b.size - a.size)
    if (sort === 'duration') sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    return sorted
  }, [items, kind, search, sort])

  const totalSize = useMemo(() => items.reduce((sum, item) => sum + item.size, 0), [items])

  const remove = async (item: LibraryItem): Promise<void> => {
    setDeleting(item.id)
    try {
      await unwrap(window.api.deleteLibraryItem(item.absPath))
      pushToast('Moved to trash: ' + (item.title ?? item.name), 'success')
      setConfirmId(null)
      onRescan()
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    } finally {
      setDeleting(null)
    }
  }

  const openFolder = async (): Promise<void> => {
    try {
      await unwrap(window.api.openPath(settings.downloadsDir))
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  return (
    <div className="panel-scroll">
      <div className="toolbar">
        <input
          className="input search"
          placeholder="Search your downloads..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="segmented">
          <button type="button" className={kind === 'all' ? 'active' : ''} onClick={() => setKind('all')}>All</button>
          <button type="button" className={kind === 'video' ? 'active' : ''} onClick={() => setKind('video')}><Video size={13} />{' '}Video</button>
          <button type="button" className={kind === 'audio' ? 'active' : ''} onClick={() => setKind('audio')}><Music size={13} />{' '}Audio</button>
        </div>
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          <option value="newest">Newest first</option>
          <option value="name">Name (A-Z)</option>
          <option value="size">Largest first</option>
          <option value="duration">Longest first</option>
        </select>
        <button type="button" className="btn" onClick={onRescan} disabled={busy}>
          <RefreshCw size={15} />
          <span>{busy ? 'Scanning' : 'Rescan'}</span>
        </button>
        <button type="button" className="btn" onClick={() => void openFolder()}>
          <FolderOpen size={15} />
          <span>Open folder</span>
        </button>
        <span className="stat">
          {filtered.length} of {items.length} · {formatBytes(totalSize)}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={40} />}
          title="Your library is empty"
          message={'Anything you download lands in ' + settings.downloadsDir + '. Grab something from the Download tab and it shows up here instantly, ready to play.'}
        >
          <button type="button" className="btn" onClick={onRescan} disabled={busy}>Rescan folder</button>
          <button type="button" className="btn ghost" onClick={() => void openFolder()}>Open folder</button>
        </EmptyState>
      ) : null}

      {items.length > 0 && filtered.length === 0 ? (
        <EmptyState icon={<Search size={34} />} title="No matches" message="Try a different search term or switch the filter." />
      ) : null}

      {filtered.length > 0 ? (
        <div className="library-grid">
          {filtered.map((item, index) => (
            <div
              className="lib-card"
              key={item.id}
              onDoubleClick={() => onPlay(item, filtered, index)}
              title="Double-click to play"
            >
              <div className="thumb">
                <span className="kind-badge">{item.kind}</span>
                {item.thumbnailUrl ? (
                  <img src={item.thumbnailUrl} alt="" loading="lazy" />
                ) : (
                  <div className="placeholder">{item.kind === 'audio' ? <Music size={26} /> : <Video size={26} />}</div>
                )}
                {item.duration ? <span className="duration">{formatDuration(item.duration)}</span> : null}
              </div>
              <div className="lib-body">
                <div className="lib-name" title={item.title ?? item.name}>{item.title ?? item.name}</div>
                <div className="lib-meta">
                  <span>{formatBytes(item.size)}</span>
                  <span>{item.ext.toUpperCase()}</span>
                  {item.subtitleFiles.length ? <span>{item.subtitleFiles.length} subtitle(s)</span> : null}
                  <span title={humanDate(item.mtime)}>{humanDate(item.mtime)}</span>
                </div>
                {confirmId === item.id ? (
                  <div className="lib-actions" onDoubleClick={(event) => event.stopPropagation()}>
                    <span className="stat" style={{ flex: 1 }}>Move to trash?</span>
                    <button type="button" className="btn small danger" disabled={deleting === item.id} onClick={() => void remove(item)}>
                      {deleting === item.id ? 'Removing' : 'Yes'}
                    </button>
                    <button type="button" className="btn small ghost" onClick={() => setConfirmId(null)}>No</button>
                  </div>
                ) : (
                  <div className="lib-actions" onDoubleClick={(event) => event.stopPropagation()}>
                    <button type="button" className="btn small primary" onClick={() => onPlay(item, filtered, index)}>
                      <Play size={14} />
                      <span>Play</span>
                    </button>
                    <button type="button" className="btn small" title="Show in folder" onClick={() => void window.api.revealPath(item.absPath)}>
                      <FolderOpen size={14} />
                    </button>
                    <button type="button" className="btn small" title="Open in default player" onClick={() => void window.api.openPath(item.absPath)}>
                      <MonitorPlay size={14} />
                    </button>
                    <button type="button" className="btn small danger" title="Move to trash" onClick={() => setConfirmId(item.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
