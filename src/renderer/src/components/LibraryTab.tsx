import { useMemo, useState, type ReactNode } from 'react'
import {
  Ellipsis,
  Eye,
  EyeOff,
  FolderOpen,
  Heart,
  Library as LibraryIcon,
  ListPlus,
  MonitorPlay,
  Music,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Video,
} from 'lucide-react'
import type { LibraryItem, LibraryState, Settings } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatDuration, humanDate } from '../lib/format'
import type { ToastTone } from '../lib/types'
import { EmptyState, MediaThumb, MoreMenu, isInProgress, type MenuEntry } from './common'

interface Props {
  items: LibraryItem[]
  busy: boolean
  settings: Settings
  libState: LibraryState
  pushToast: (message: string, tone?: ToastTone) => void
  onRescan: () => void
  onPlay: (list: LibraryItem[], index: number, shuffle?: boolean) => void
  onAddToPlaylist: (keys: string[]) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
}

type Filter = 'all' | 'video' | 'audio' | 'favorites' | 'unwatched'
type SortKey = 'newest' | 'name' | 'size' | 'duration'

/** The per-item menu shared by the Library and Playlists tabs. */
export function itemMenu(
  item: LibraryItem,
  libState: LibraryState,
  actions: { onAddToPlaylist: (keys: string[]) => void; onDelete?: () => void; extra?: MenuEntry[] },
): MenuEntry[] {
  const watched = !!libState.progress[item.key]?.watched
  const favorite = libState.favorites.includes(item.key)
  const entries: MenuEntry[] = [
    { label: 'Add to playlist...', icon: <ListPlus size={14} />, onSelect: () => actions.onAddToPlaylist([item.key]) },
    { label: favorite ? 'Remove from favorites' : 'Add to favorites', icon: <Heart size={14} />, onSelect: () => void window.api.toggleFavorite(item.key) },
    {
      label: watched ? 'Mark as unwatched' : 'Mark as watched',
      icon: watched ? <EyeOff size={14} /> : <Eye size={14} />,
      onSelect: () => void window.api.setWatched(item.key, !watched),
    },
    ...(actions.extra ?? []),
    { label: 'Show in folder', icon: <FolderOpen size={14} />, onSelect: () => void window.api.revealPath(item.absPath) },
    { label: 'Open in default player', icon: <MonitorPlay size={14} />, onSelect: () => void window.api.openPath(item.absPath) },
  ]
  if (actions.onDelete) entries.push({ label: 'Move to trash', icon: <Trash2 size={14} />, danger: true, onSelect: actions.onDelete })
  return entries
}

export default function LibraryTab({ items, busy, settings, libState, pushToast, onRescan, onPlay, onAddToPlaylist }: Props): ReactNode {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortKey>('newest')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'video' || filter === 'audio') list = list.filter((item) => item.kind === filter)
    if (filter === 'favorites') list = list.filter((item) => libState.favorites.includes(item.key))
    if (filter === 'unwatched') list = list.filter((item) => !libState.progress[item.key]?.watched)
    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter((item) => {
        const haystack = ((item.title ?? '') + ' ' + item.name + ' ' + (item.uploader ?? '') + ' ' + (item.folder ?? '')).toLowerCase()
        return haystack.includes(query)
      })
    }
    const sorted = list.slice()
    if (sort === 'newest') sorted.sort((a, b) => b.mtime - a.mtime)
    if (sort === 'name') sorted.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name))
    if (sort === 'size') sorted.sort((a, b) => b.size - a.size)
    if (sort === 'duration') sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    return sorted
  }, [items, filter, search, sort, libState])

  const continueWatching = useMemo(
    () =>
      items
        .filter((item) => isInProgress(libState.progress[item.key]))
        .sort((a, b) => (libState.progress[b.key]?.updatedAt ?? 0) - (libState.progress[a.key]?.updatedAt ?? 0))
        .slice(0, 12),
    [items, libState],
  )

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

  const FILTERS: { id: Filter; label: ReactNode }[] = [
    { id: 'all', label: 'All' },
    { id: 'video', label: <><Video size={13} />{' '}Video</> },
    { id: 'audio', label: <><Music size={13} />{' '}Audio</> },
    { id: 'favorites', label: <><Heart size={13} />{' '}Favorites</> },
    { id: 'unwatched', label: 'Unwatched' },
  ]

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
          {FILTERS.map((entry) => (
            <button key={entry.id} type="button" className={filter === entry.id ? 'active' : ''} onClick={() => setFilter(entry.id)}>
              {entry.label}
            </button>
          ))}
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
      </div>

      {continueWatching.length && filter === 'all' && !search.trim() ? (
        <section className="shelf">
          <div className="shelf-title">Continue watching</div>
          <div className="shelf-row">
            {continueWatching.map((item) => {
              const progress = libState.progress[item.key]
              return (
                <button key={item.id} type="button" className="mini-card" onClick={() => onPlay([item], 0)} title={item.title ?? item.name}>
                  <MediaThumb item={item} progress={progress} />
                  <span className="mini-name">{item.title ?? item.name}</span>
                  <span className="mini-meta">
                    {progress ? formatDuration(progress.duration - progress.position) + ' left' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {items.length > 0 ? (
        <div className="row" style={{ marginBottom: 14 }}>
          <button type="button" className="btn primary small" disabled={!filtered.length} onClick={() => onPlay(filtered, 0)}>
            <Play size={14} />
            <span>Play all</span>
          </button>
          <button type="button" className="btn small" disabled={filtered.length < 2} onClick={() => onPlay(filtered, -1, true)}>
            <Shuffle size={14} />
            <span>Shuffle</span>
          </button>
          <span className="stat">
            {filtered.length} of {items.length} · {formatBytes(totalSize)}
          </span>
        </div>
      ) : null}

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
        filter === 'favorites' && !search.trim() ? (
          <EmptyState icon={<Heart size={34} />} title="No favorites yet" message="Click the heart on any item to keep it here." />
        ) : (
          <EmptyState icon={<Search size={34} />} title="No matches" message="Try a different search term or switch the filter." />
        )
      ) : null}

      {filtered.length > 0 ? (
        <div className="library-grid">
          {filtered.map((item, index) => {
            const progress = libState.progress[item.key]
            const favorite = libState.favorites.includes(item.key)
            return (
              <div className="lib-card" key={item.id} onDoubleClick={() => onPlay(filtered, index)} title="Double-click to play">
                <MediaThumb item={item} progress={progress} favorite={favorite} onToggleFavorite={() => void window.api.toggleFavorite(item.key)} />
                <div className="lib-body">
                  <div className="lib-name" title={item.title ?? item.name}>{item.title ?? item.name}</div>
                  <div className="lib-meta">
                    {item.folder ? <span className="folder-tag" title={item.folder}>{item.folder}</span> : null}
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
                      <button type="button" className="btn small primary" onClick={() => onPlay(filtered, index)}>
                        <Play size={14} />
                        <span>Play</span>
                      </button>
                      <button type="button" className="btn small" title="Add to playlist" onClick={() => onAddToPlaylist([item.key])}>
                        <ListPlus size={14} />
                      </button>
                      <MoreMenu
                        icon={<Ellipsis size={14} />}
                        className="btn small"
                        items={itemMenu(item, libState, { onAddToPlaylist, onDelete: () => setConfirmId(item.id) })}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
