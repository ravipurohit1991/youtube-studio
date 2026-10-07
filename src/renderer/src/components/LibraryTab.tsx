import { useMemo, useState, type ReactNode } from 'react'
import {
  CheckSquare,
  Ellipsis,
  Eye,
  EyeOff,
  FolderOpen,
  Heart,
  LayoutGrid,
  Library as LibraryIcon,
  List,
  ListPlus,
  MonitorPlay,
  Music,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Subtitles,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import type { LibraryItem, LibraryState, Settings } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatBytes, formatDuration, formatHours, humanDate, timeAgo } from '../lib/format'
import { usePref } from '../lib/prefs'
import type { PushToast } from '../lib/types'
import { EmptyState, MediaThumb, MoreMenu, isInProgress, type MenuEntry } from './common'

interface Props {
  items: LibraryItem[]
  busy: boolean
  settings: Settings
  libState: LibraryState
  pushToast: PushToast
  onRescan: () => void
  onPlay: (list: LibraryItem[], index: number, shuffle?: boolean) => void
  onAddToPlaylist: (keys: string[]) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
}

type Filter = 'all' | 'video' | 'audio' | 'favorites' | 'unwatched'
type SortKey = 'newest' | 'played' | 'name' | 'channel' | 'size' | 'duration'

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
  const [sort, setSort] = usePref<SortKey>('library.sort', 'newest')
  const [view, setView] = usePref<'grid' | 'list'>('library.view', 'grid')
  const [channel, setChannel] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)

  const channels = useMemo(() => {
    const counts = new Map<string, number>()
    items.forEach((item) => {
      if (item.uploader) counts.set(item.uploader, (counts.get(item.uploader) ?? 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (filter === 'video' || filter === 'audio') list = list.filter((item) => item.kind === filter)
    if (filter === 'favorites') list = list.filter((item) => libState.favorites.includes(item.key))
    if (filter === 'unwatched') list = list.filter((item) => !libState.progress[item.key]?.watched)
    if (channel) list = list.filter((item) => item.uploader === channel)
    const query = search.trim().toLowerCase()
    if (query) {
      list = list.filter((item) => {
        const haystack = ((item.title ?? '') + ' ' + item.name + ' ' + (item.uploader ?? '') + ' ' + (item.folder ?? '')).toLowerCase()
        return query.split(/\s+/).every((word) => haystack.includes(word))
      })
    }
    const sorted = list.slice()
    if (sort === 'newest') sorted.sort((a, b) => b.mtime - a.mtime)
    if (sort === 'played') sorted.sort((a, b) => (libState.progress[b.key]?.updatedAt ?? 0) - (libState.progress[a.key]?.updatedAt ?? 0))
    if (sort === 'name') sorted.sort((a, b) => (a.title ?? a.name).localeCompare(b.title ?? b.name))
    if (sort === 'channel') sorted.sort((a, b) => (a.uploader ?? '~').localeCompare(b.uploader ?? '~') || (a.title ?? a.name).localeCompare(b.title ?? b.name))
    if (sort === 'size') sorted.sort((a, b) => b.size - a.size)
    if (sort === 'duration') sorted.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
    return sorted
  }, [items, filter, search, sort, libState, channel])

  const continueWatching = useMemo(
    () =>
      items
        .filter((item) => isInProgress(libState.progress[item.key]))
        .sort((a, b) => (libState.progress[b.key]?.updatedAt ?? 0) - (libState.progress[a.key]?.updatedAt ?? 0))
        .slice(0, 12),
    [items, libState],
  )

  const totals = useMemo(
    () => ({
      size: filtered.reduce((sum, item) => sum + item.size, 0),
      seconds: filtered.reduce((sum, item) => sum + (item.duration ?? 0), 0),
    }),
    [filtered],
  )

  const selectedItems = useMemo(() => filtered.filter((item) => selected.has(item.key)), [filtered, selected])

  const toggle = (key: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const clearSelection = (): void => {
    setSelected(new Set())
    setSelecting(false)
    setConfirmBulk(false)
  }

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

  const removeSelected = async (): Promise<void> => {
    let moved = 0
    for (const item of selectedItems) {
      try {
        await unwrap(window.api.deleteLibraryItem(item.absPath))
        moved += 1
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    }
    pushToast(moved + ' item(s) moved to the trash.', 'success')
    clearSelection()
    onRescan()
  }

  const bulkFavorite = async (): Promise<void> => {
    const missing = selectedItems.filter((item) => !libState.favorites.includes(item.key))
    const targets = missing.length ? missing : selectedItems
    for (const item of targets) await window.api.toggleFavorite(item.key)
    pushToast(missing.length ? missing.length + ' added to favorites.' : 'Removed from favorites.', 'success')
  }

  const bulkWatched = async (): Promise<void> => {
    const unwatched = selectedItems.filter((item) => !libState.progress[item.key]?.watched)
    const mark = unwatched.length > 0
    for (const item of selectedItems) await window.api.setWatched(item.key, mark)
    pushToast(selectedItems.length + ' marked as ' + (mark ? 'watched.' : 'unwatched.'), 'success')
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
    { id: 'video', label: <><Video size={13} />Video</> },
    { id: 'audio', label: <><Music size={13} />Audio</> },
    { id: 'favorites', label: <><Heart size={13} />Favorites</> },
    { id: 'unwatched', label: 'Unwatched' },
  ]

  const checkbox = (item: LibraryItem): ReactNode => (
    <label className="select-box" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} title="Select">
      <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
    </label>
  )

  return (
    <div className="panel-scroll">
      <div className="toolbar">
        <div className="search-wrap">
          <Search size={15} />
          <input className="input search" placeholder="Search titles, channels, folders..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="segmented">
          {FILTERS.map((entry) => (
            <button key={entry.id} type="button" className={filter === entry.id ? 'active' : ''} onClick={() => setFilter(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        {channels.length > 1 ? (
          <select className="select" value={channel} onChange={(event) => setChannel(event.target.value)} title="Channel" style={{ maxWidth: 170 }}>
            <option value="">All channels</option>
            {channels.map(([name, count]) => (
              <option key={name} value={name}>{name + ' (' + count + ')'}</option>
            ))}
          </select>
        ) : null}
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} title="Sort">
          <option value="newest">Newest first</option>
          <option value="played">Recently played</option>
          <option value="name">Name (A-Z)</option>
          <option value="channel">Channel</option>
          <option value="size">Largest first</option>
          <option value="duration">Longest first</option>
        </select>
        <div className="segmented" title="View">
          <button type="button" className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid size={14} /></button>
          <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List view"><List size={14} /></button>
        </div>
        <button type="button" className="btn" onClick={onRescan} disabled={busy}>
          <RefreshCw size={15} className={busy ? 'spin' : ''} />
          <span>{busy ? 'Scanning' : 'Rescan'}</span>
        </button>
        <button type="button" className="btn icon" onClick={() => void openFolder()} title="Open the downloads folder" aria-label="Open folder">
          <FolderOpen size={16} />
        </button>
      </div>

      {continueWatching.length && filter === 'all' && !search.trim() && !channel ? (
        <section className="shelf">
          <div className="shelf-head"><span className="shelf-title">Continue watching</span></div>
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

      {selected.size ? (
        <div className="bulk-bar">
          <strong>{selected.size} selected</strong>
          {confirmBulk ? (
            <>
              <span className="stat">Move {selected.size} item(s) to the trash?</span>
              <button type="button" className="btn small danger" onClick={() => void removeSelected()}>Yes, move</button>
              <button type="button" className="btn small ghost" onClick={() => setConfirmBulk(false)}>No</button>
            </>
          ) : (
            <>
              <button type="button" className="btn small primary" onClick={() => onPlay(selectedItems, 0)}>
                <Play size={14} />
                <span>Play</span>
              </button>
              <button type="button" className="btn small" onClick={() => onAddToPlaylist(selectedItems.map((item) => item.key))}>
                <ListPlus size={14} />
                <span>Add to playlist</span>
              </button>
              <button type="button" className="btn small" onClick={() => void bulkFavorite()}>
                <Heart size={14} />
                <span>Favorite</span>
              </button>
              <button type="button" className="btn small" onClick={() => void bulkWatched()}>
                <Eye size={14} />
                <span>Watched</span>
              </button>
              <button type="button" className="btn small danger" onClick={() => setConfirmBulk(true)}>
                <Trash2 size={14} />
                <span>Trash</span>
              </button>
              <button type="button" className="btn small ghost" onClick={() => setSelected(new Set(filtered.map((item) => item.key)))}>Select all {filtered.length}</button>
            </>
          )}
          <button type="button" className="btn small ghost" style={{ marginLeft: 'auto' }} onClick={clearSelection} aria-label="Clear selection">
            <X size={14} />
          </button>
        </div>
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
          <button type="button" className={'btn small ghost' + (selecting ? ' on' : '')} onClick={() => (selecting ? clearSelection() : setSelecting(true))}>
            <CheckSquare size={14} />
            <span>{selecting ? 'Done' : 'Select'}</span>
          </button>
          <span className="stat">
            {filtered.length} of {items.length} · {formatBytes(totals.size)}{totals.seconds ? ' · ' + formatHours(totals.seconds) : ''}
          </span>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<LibraryIcon size={34} />}
          title="Your library is empty"
          message={'Anything you download lands in ' + settings.downloadsDir + '. Grab something from Home or the Download tab and it shows up here, ready to play.'}
        >
          <button type="button" className="btn" onClick={onRescan} disabled={busy}>Rescan folder</button>
          <button type="button" className="btn ghost" onClick={() => void openFolder()}>Open folder</button>
        </EmptyState>
      ) : null}

      {items.length > 0 && filtered.length === 0 ? (
        filter === 'favorites' && !search.trim() ? (
          <EmptyState icon={<Heart size={30} />} title="No favorites yet" message="Click the heart on any item to keep it here." />
        ) : (
          <EmptyState icon={<Search size={30} />} title="No matches" message="Try a different search term or switch the filter." />
        )
      ) : null}

      {filtered.length > 0 && view === 'grid' ? (
        <div className={'library-grid' + (selecting || selected.size ? ' selecting' : '')}>
          {filtered.map((item, index) => {
            const progress = libState.progress[item.key]
            const favorite = libState.favorites.includes(item.key)
            const isSelected = selected.has(item.key)
            return (
              <div
                className={'lib-card' + (isSelected ? ' selected' : '')}
                key={item.id}
                onClick={(event) => {
                  if (selecting || selected.size || event.ctrlKey || event.metaKey) toggle(item.key)
                }}
                onDoubleClick={() => onPlay(filtered, index)}
                title="Double-click to play"
              >
                {checkbox(item)}
                <MediaThumb item={item} progress={progress} favorite={favorite} onToggleFavorite={() => void window.api.toggleFavorite(item.key)} />
                <div className="lib-body">
                  <div className="lib-name" title={item.title ?? item.name}>{item.title ?? item.name}</div>
                  <div className="lib-meta">
                    {item.folder ? <span className="folder-tag" title={item.folder}>{item.folder}</span> : item.uploader ? <span className="folder-tag" title={item.uploader}>{item.uploader}</span> : null}
                    <span>{formatBytes(item.size)}</span>
                    <span>{item.ext.toUpperCase()}</span>
                    {item.subtitles.length ? <span title={item.subtitles.map((s) => s.lang).join(', ')}><Subtitles size={11} style={{ verticalAlign: -1 }} /> {item.subtitles.length}</span> : null}
                    <span title={humanDate(item.mtime)}>{timeAgo(item.mtime)}</span>
                  </div>
                  {confirmId === item.id ? (
                    <div className="lib-actions" onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                      <span className="stat" style={{ flex: 1 }}>Move to trash?</span>
                      <button type="button" className="btn small danger" disabled={deleting === item.id} onClick={() => void remove(item)}>
                        {deleting === item.id ? 'Removing' : 'Yes'}
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => setConfirmId(null)}>No</button>
                    </div>
                  ) : (
                    <div className="lib-actions" onDoubleClick={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                      <button type="button" className="btn small primary" onClick={() => onPlay(filtered, index)}>
                        <Play size={14} />
                        <span>{isInProgress(progress) ? 'Resume' : 'Play'}</span>
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

      {filtered.length > 0 && view === 'list' ? (
        <div className="lib-list">
          {filtered.map((item, index) => {
            const progress = libState.progress[item.key]
            const favorite = libState.favorites.includes(item.key)
            const isSelected = selected.has(item.key)
            return (
              <div
                key={item.id}
                className={'lib-row' + (isSelected ? ' selected' : '')}
                onClick={(event) => {
                  if (selecting || selected.size || event.ctrlKey || event.metaKey) toggle(item.key)
                }}
                onDoubleClick={() => onPlay(filtered, index)}
              >
                {selecting || selected.size ? <input type="checkbox" checked={isSelected} onChange={() => toggle(item.key)} onClick={(event) => event.stopPropagation()} /> : null}
                <MediaThumb item={item} progress={progress} />
                <div className="lib-row-text">
                  <div className="lib-row-title" title={item.title ?? item.name}>{item.title ?? item.name}</div>
                  <div className="lib-meta" style={{ marginTop: 3 }}>
                    {item.uploader ? <span>{item.uploader}</span> : null}
                    {item.folder ? <span className="folder-tag">{item.folder}</span> : null}
                    <span>{item.duration ? formatDuration(item.duration) : item.ext.toUpperCase()}</span>
                    <span>{formatBytes(item.size)}</span>
                    {progress?.watched ? <span>watched</span> : isInProgress(progress) ? <span>{formatDuration((progress?.duration ?? 0) - (progress?.position ?? 0))} left</span> : null}
                    <span>{timeAgo(item.mtime)}</span>
                  </div>
                </div>
                <div className="row tight nowrap" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                  <button type="button" className={'btn small ghost' + (favorite ? ' on' : '')} title={favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={() => void window.api.toggleFavorite(item.key)}>
                    <Heart size={14} fill={favorite ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" className="btn small primary" onClick={() => onPlay(filtered, index)}>
                    <Play size={14} />
                  </button>
                  <MoreMenu icon={<Ellipsis size={14} />} className="btn small ghost" items={itemMenu(item, libState, { onAddToPlaylist, onDelete: () => void remove(item) })} />
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
