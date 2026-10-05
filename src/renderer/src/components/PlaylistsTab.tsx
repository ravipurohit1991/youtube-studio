import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Ellipsis, FolderOpen, FolderSync, ListVideo, Pencil, Play, Plus, RefreshCw, Shuffle, Trash2, X } from 'lucide-react'
import type { LibraryItem, LibraryState, SavedPlaylist, Settings } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { formatDuration, timeAgo } from '../lib/format'
import type { ToastTone } from '../lib/types'
import { EmptyState, MediaThumb, MoreMenu, PromptDialog, hideBroken, isInProgress } from './common'
import { itemMenu } from './LibraryTab'

type Selection = { kind: 'folder'; name: string } | { kind: 'user'; id: string }

interface Props {
  items: LibraryItem[]
  libState: LibraryState
  settings: Settings
  syncing: string[]
  pushToast: (message: string, tone?: ToastTone) => void
  onPlay: (list: LibraryItem[], index: number, shuffle?: boolean) => void
  onAddToPlaylist: (keys: string[]) => void
  onSync: (playlist: SavedPlaylist) => void
}

function sameSelection(a: Selection | null, b: Selection): boolean {
  if (!a || a.kind !== b.kind) return false
  return a.kind === 'folder' ? a.name === (b as { name: string }).name : a.id === (b as { id: string }).id
}

/** Downloaded YouTube playlists (one folder each, optionally kept in sync) and playlists made in the app. */
export default function PlaylistsTab({ items, libState, settings, syncing, pushToast, onPlay, onAddToPlaylist, onSync }: Props): ReactNode {
  const [selection, setSelection] = useState<Selection | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const byKey = useMemo(() => new Map(items.map((item) => [item.key, item])), [items])

  const folders = useMemo(() => {
    const map = new Map<string, LibraryItem[]>()
    items.forEach((item) => {
      if (!item.folder) return
      const list = map.get(item.folder) ?? []
      list.push(item)
      map.set(item.folder, list)
    })
    // A synced playlist whose first downloads are still running has a folder-to-be.
    libState.saved.forEach((saved) => {
      if (saved.folder && !map.has(saved.folder)) map.set(saved.folder, [])
    })
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, items: list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [items, libState.saved])

  const savedFor = (folder: string): SavedPlaylist | undefined => libState.saved.find((p) => p.folder === folder)
  // Synced playlists saved without a folder (folders turned off) are listed on their own.
  const looseSaved = libState.saved.filter((p) => !p.folder)

  const current = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'folder') {
      const folder = folders.find((f) => f.name === selection.name)
      return folder ? { title: folder.name, items: folder.items, user: null, saved: savedFor(folder.name) ?? null } : null
    }
    const playlist = libState.playlists.find((p) => p.id === selection.id)
    if (!playlist) return null
    return {
      title: playlist.name,
      items: playlist.items.map((key) => byKey.get(key)).filter((item): item is LibraryItem => !!item),
      user: playlist,
      saved: null,
    }
  }, [selection, folders, libState, byKey])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const totalDuration = (list: LibraryItem[]): string => {
    const seconds = list.reduce((sum, item) => sum + (item.duration ?? 0), 0)
    return seconds > 0 ? ' · ' + formatDuration(seconds) : ''
  }

  return (
    <div className="pl-layout">
      <aside className="pl-list">
        <button type="button" className="btn primary" style={{ width: '100%' }} onClick={() => setCreating(true)}>
          <Plus size={15} />
          <span>New playlist</span>
        </button>

        <div className="pl-section">Your playlists</div>
        {libState.playlists.length ? (
          libState.playlists.map((playlist) => {
            const sel: Selection = { kind: 'user', id: playlist.id }
            const first = playlist.items.map((key) => byKey.get(key)).find(Boolean)
            return (
              <button key={playlist.id} type="button" className={'pl-item' + (sameSelection(selection, sel) ? ' active' : '')} onClick={() => setSelection(sel)}>
                <span className="pl-cover">{first?.thumbnailUrl ? <img src={first.thumbnailUrl} alt="" onError={hideBroken} /> : <ListVideo size={16} />}</span>
                <span className="pl-text">
                  <span className="pl-name">{playlist.name}</span>
                  <span className="pl-meta">{playlist.items.length} item(s)</span>
                </span>
              </button>
            )
          })
        ) : (
          <div className="hint" style={{ padding: '4px 6px' }}>Make one, then add videos from the Library with the + button.</div>
        )}

        <div className="pl-section">Downloaded playlists</div>
        {folders.length ? (
          folders.map((folder) => {
            const sel: Selection = { kind: 'folder', name: folder.name }
            const saved = savedFor(folder.name)
            return (
              <button key={folder.name} type="button" className={'pl-item' + (sameSelection(selection, sel) ? ' active' : '')} onClick={() => setSelection(sel)}>
                <span className="pl-cover">{folder.items[0]?.thumbnailUrl ? <img src={folder.items[0].thumbnailUrl} alt="" onError={hideBroken} /> : <FolderOpen size={16} />}</span>
                <span className="pl-text">
                  <span className="pl-name">{folder.name}</span>
                  <span className="pl-meta">
                    {folder.items.length} item(s)
                    {saved ? ' · synced ' + timeAgo(saved.lastSync) : ''}
                  </span>
                </span>
                {saved ? <FolderSync size={14} className="pl-badge" /> : null}
              </button>
            )
          })
        ) : (
          <div className="hint" style={{ padding: '4px 6px' }}>
            {settings.playlistFolders
              ? 'Download a YouTube playlist and it shows up here, in playlist order.'
              : 'Playlist folders are off in Settings, so playlist downloads land in the main folder.'}
          </div>
        )}

        {looseSaved.length ? (
          <>
            <div className="pl-section">Synced (no folder)</div>
            {looseSaved.map((saved) => (
              <div key={saved.id} className="pl-item static">
                <span className="pl-text">
                  <span className="pl-name">{saved.title}</span>
                  <span className="pl-meta">synced {timeAgo(saved.lastSync)}</span>
                </span>
                <button type="button" className="btn small" disabled={syncing.includes(saved.id)} onClick={() => onSync(saved)} title="Sync now">
                  <RefreshCw size={13} className={syncing.includes(saved.id) ? 'spin' : ''} />
                </button>
              </div>
            ))}
          </>
        ) : null}
      </aside>

      <section className="pl-detail">
        {!current ? (
          <EmptyState
            icon={<ListVideo size={40} />}
            title="Playlists"
            message="Downloaded YouTube playlists get a folder each and play in order. Keep them in sync to grab new videos, or build your own playlists from anything in your library."
          />
        ) : (
          <>
            <div className="pl-head">
              <div className="pl-hero">
                {current.items[0]?.thumbnailUrl ? <img src={current.items[0].thumbnailUrl} alt="" onError={hideBroken} /> : <ListVideo size={36} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="pl-kind">{current.user ? 'Your playlist' : current.saved ? 'Downloaded playlist · kept in sync' : 'Downloaded playlist'}</div>
                <h2>{current.title}</h2>
                <div className="stat">
                  {current.items.length} item(s){totalDuration(current.items)}
                  {current.saved ? ' · last synced ' + timeAgo(current.saved.lastSync) + (current.saved.lastAdded ? ' (' + current.saved.lastAdded + ' new)' : '') : ''}
                </div>
                <div className="row tight" style={{ marginTop: 12 }}>
                  <button type="button" className="btn primary" disabled={!current.items.length} onClick={() => onPlay(current.items, 0)}>
                    <Play size={15} />
                    <span>Play all</span>
                  </button>
                  <button type="button" className="btn" disabled={current.items.length < 2} onClick={() => onPlay(current.items, -1, true)}>
                    <Shuffle size={15} />
                    <span>Shuffle</span>
                  </button>
                  {current.saved ? (
                    <button type="button" className="btn" disabled={syncing.includes(current.saved.id)} onClick={() => onSync(current.saved as SavedPlaylist)}>
                      <RefreshCw size={15} className={syncing.includes(current.saved.id) ? 'spin' : ''} />
                      <span>{syncing.includes(current.saved.id) ? 'Syncing' : 'Sync new videos'}</span>
                    </button>
                  ) : null}
                  {selection?.kind === 'folder' && current.items[0] ? (
                    <button type="button" className="btn ghost" onClick={() => void window.api.revealPath(current.items[0].absPath)}>
                      <FolderOpen size={15} />
                      <span>Show folder</span>
                    </button>
                  ) : null}
                  {current.user ? (
                    <>
                      <button type="button" className="btn ghost" onClick={() => setRenaming(true)}>
                        <Pencil size={15} />
                        <span>Rename</span>
                      </button>
                      {confirmDelete ? (
                        <>
                          <span className="stat">Delete playlist? Files stay.</span>
                          <button
                            type="button"
                            className="btn small danger"
                            onClick={() => {
                              const id = current.user?.id
                              if (!id) return
                              setConfirmDelete(false)
                              setSelection(null)
                              void run(() => unwrap(window.api.deletePlaylist(id)))
                            }}
                          >
                            Yes
                          </button>
                          <button type="button" className="btn small ghost" onClick={() => setConfirmDelete(false)}>No</button>
                        </>
                      ) : (
                        <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
                          <Trash2 size={15} />
                          <span>Delete</span>
                        </button>
                      )}
                    </>
                  ) : null}
                  {current.saved ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        const id = current.saved?.id
                        if (id) void run(() => unwrap(window.api.removeSavedPlaylist(id)))
                      }}
                    >
                      <X size={15} />
                      <span>Stop syncing</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {current.items.length === 0 ? (
              <EmptyState
                icon={<ListVideo size={34} />}
                title="Nothing here yet"
                message={current.user ? 'Add videos or songs from the Library with the + button.' : 'Its downloads may still be running; they show up here when they finish.'}
              />
            ) : (
              <div className="pl-rows">
                {current.items.map((item, index) => {
                  const progress = libState.progress[item.key]
                  const user = current.user
                  return (
                    <div key={item.key} className="pl-row" onDoubleClick={() => onPlay(current.items, index)}>
                      <span className="pl-index">{index + 1}</span>
                      <div className="pl-row-thumb">
                        <MediaThumb item={item} progress={progress} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="pl-row-title">{item.title ?? item.name}</div>
                        <div className="stat">
                          {[item.duration ? formatDuration(item.duration) : null, item.ext.toUpperCase()].filter(Boolean).join(' · ')}
                          {progress?.watched ? ' · watched' : isInProgress(progress) ? ' · ' + formatDuration(progress!.duration - progress!.position) + ' left' : ''}
                        </div>
                      </div>
                      <div className="row tight" onDoubleClick={(event) => event.stopPropagation()}>
                        <button type="button" className="btn small primary" onClick={() => onPlay(current.items, index)} title="Play from here">
                          <Play size={14} />
                        </button>
                        {user ? (
                          <>
                            <button type="button" className="btn small" disabled={index === 0} title="Move up" onClick={() => void run(() => unwrap(window.api.movePlaylistItem(user.id, index, index - 1)))}>
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn small"
                              disabled={index === current.items.length - 1}
                              title="Move down"
                              onClick={() => void run(() => unwrap(window.api.movePlaylistItem(user.id, index, index + 1)))}
                            >
                              <ArrowDown size={14} />
                            </button>
                            <button type="button" className="btn small ghost" title="Remove from playlist" onClick={() => void run(() => unwrap(window.api.removeFromPlaylist(user.id, item.key)))}>
                              <X size={14} />
                            </button>
                          </>
                        ) : null}
                        <MoreMenu icon={<Ellipsis size={14} />} className="btn small ghost" items={itemMenu(item, libState, { onAddToPlaylist })} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </section>

      {creating ? (
        <PromptDialog
          title="New playlist"
          confirm="Create"
          placeholder="Playlist name"
          onCancel={() => setCreating(false)}
          onConfirm={(name) => {
            setCreating(false)
            void run(async () => {
              const playlist = await unwrap(window.api.createPlaylist(name))
              setSelection({ kind: 'user', id: playlist.id })
            })
          }}
        />
      ) : null}
      {renaming && current?.user ? (
        <PromptDialog
          title="Rename playlist"
          initial={current.user.name}
          confirm="Save"
          onCancel={() => setRenaming(false)}
          onConfirm={(name) => {
            const id = current.user?.id
            setRenaming(false)
            if (id) void run(() => unwrap(window.api.renamePlaylist(id, name)))
          }}
        />
      ) : null}
    </div>
  )
}
