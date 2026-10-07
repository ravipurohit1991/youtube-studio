import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LibraryState, SavedPlaylist, UserPlaylist, WatchProgress } from '@shared/types'
import { IPC } from '@shared/ipc'
import { broadcast } from './bus'
import { logError } from './logger'
import { userDataDir } from './paths'

/**
 * Favorites, watch progress, the user's own playlists and synced YouTube playlists. Items are
 * referenced by their path relative to the downloads folder, so the data survives a restart and
 * stays valid as long as the files are not renamed.
 */
class LibraryStateStore {
  private data: LibraryState = { favorites: [], progress: {}, playlists: [], saved: [] }
  private saveTimer: NodeJS.Timeout | null = null

  private file(): string {
    return join(userDataDir(), 'library-state.json')
  }

  load(): void {
    try {
      if (!existsSync(this.file())) return
      const raw = JSON.parse(readFileSync(this.file(), 'utf8')) as Partial<LibraryState>
      this.data = {
        favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((k) => typeof k === 'string') : [],
        progress: raw.progress && typeof raw.progress === 'object' ? raw.progress : {},
        playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
        saved: Array.isArray(raw.saved) ? raw.saved : [],
      }
    } catch (err) {
      logError('libraryState.load', err)
    }
  }

  get(): LibraryState {
    return this.data
  }

  toggleFavorite(key: string): LibraryState {
    const has = this.data.favorites.includes(key)
    return this.commit({ ...this.data, favorites: has ? this.data.favorites.filter((k) => k !== key) : [...this.data.favorites, key] })
  }

  /** Quiet update while playing: persisted, but not broadcast on every tick. */
  saveProgress(key: string, position: number, duration: number): void {
    if (!key || !isFinite(position) || !isFinite(duration) || duration <= 0) return
    const previous = this.data.progress[key]
    const done = position >= duration * 0.95
    // Re-watching something already finished keeps it "watched" until marked unwatched.
    const watched = done || (!!previous?.watched && position < 5)
    const next: WatchProgress = { position, duration, updatedAt: Date.now(), watched }
    this.data = { ...this.data, progress: { ...this.data.progress, [key]: next } }
    this.persist()
    if (done !== !!previous?.watched) broadcast(IPC.libStateChanged, this.data)
  }

  /** Push the latest state to the window (after a run of quiet progress updates). */
  announce(): void {
    broadcast(IPC.libStateChanged, this.data)
  }

  setWatched(key: string, watched: boolean): LibraryState {
    const previous = this.data.progress[key]
    const duration = previous?.duration ?? 0
    const next: WatchProgress = { position: watched ? duration : 0, duration, updatedAt: Date.now(), watched }
    return this.commit({ ...this.data, progress: { ...this.data.progress, [key]: next } })
  }

  createPlaylist(name: string, items: string[] = []): UserPlaylist {
    const playlist: UserPlaylist = {
      id: randomUUID(),
      name: name.trim() || 'New playlist',
      items: Array.from(new Set(items)),
      createdAt: Date.now(),
    }
    this.commit({ ...this.data, playlists: [...this.data.playlists, playlist] })
    return playlist
  }

  renamePlaylist(id: string, name: string): LibraryState {
    return this.editPlaylist(id, (p) => ({ ...p, name: name.trim() || p.name }))
  }

  deletePlaylist(id: string): LibraryState {
    return this.commit({ ...this.data, playlists: this.data.playlists.filter((p) => p.id !== id) })
  }

  addToPlaylist(id: string, keys: string[]): LibraryState {
    return this.editPlaylist(id, (p) => ({ ...p, items: Array.from(new Set([...p.items, ...keys])) }))
  }

  removeFromPlaylist(id: string, key: string): LibraryState {
    return this.editPlaylist(id, (p) => ({ ...p, items: p.items.filter((k) => k !== key) }))
  }

  movePlaylistItem(id: string, from: number, to: number): LibraryState {
    return this.editPlaylist(id, (p) => {
      if (from < 0 || from >= p.items.length || to < 0 || to >= p.items.length) return p
      const items = p.items.slice()
      const [moved] = items.splice(from, 1)
      items.splice(to, 0, moved)
      return { ...p, items }
    })
  }

  savePlaylist(playlist: SavedPlaylist): LibraryState {
    return this.commit({ ...this.data, saved: [...this.data.saved.filter((p) => p.id !== playlist.id), playlist] })
  }

  removeSaved(id: string): LibraryState {
    return this.commit({ ...this.data, saved: this.data.saved.filter((p) => p.id !== id) })
  }

  markSynced(id: string, newIds: string[]): LibraryState {
    return this.commit({
      ...this.data,
      saved: this.data.saved.map((p) =>
        p.id === id ? { ...p, knownIds: Array.from(new Set([...p.knownIds, ...newIds])), lastSync: Date.now(), lastAdded: newIds.length } : p,
      ),
    })
  }

  /**
   * Merge a backup in: favorites are combined, the newer progress wins per item, playlists and
   * synced playlists are added (same id: the incoming one gains any items it is missing).
   */
  merge(incoming: Partial<LibraryState>): LibraryState {
    const favorites = Array.from(new Set([...this.data.favorites, ...(Array.isArray(incoming.favorites) ? incoming.favorites.filter((k) => typeof k === 'string') : [])]))
    const progress = { ...this.data.progress }
    if (incoming.progress && typeof incoming.progress === 'object') {
      Object.entries(incoming.progress).forEach(([key, value]) => {
        if (!value || typeof value.position !== 'number') return
        const current = progress[key]
        if (!current || (value.updatedAt ?? 0) > current.updatedAt) progress[key] = value
      })
    }
    const playlists = this.data.playlists.slice()
    ;(Array.isArray(incoming.playlists) ? incoming.playlists : []).forEach((p) => {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.items)) return
      const index = playlists.findIndex((x) => x.id === p.id)
      if (index < 0) playlists.push({ id: p.id, name: String(p.name || 'Playlist'), items: p.items.filter((k) => typeof k === 'string'), createdAt: p.createdAt || Date.now() })
      else playlists[index] = { ...playlists[index], items: Array.from(new Set([...playlists[index].items, ...p.items])) }
    })
    const saved = this.data.saved.slice()
    ;(Array.isArray(incoming.saved) ? incoming.saved : []).forEach((p) => {
      if (!p || typeof p.id !== 'string' || typeof p.url !== 'string') return
      const index = saved.findIndex((x) => x.id === p.id)
      if (index < 0) saved.push({ ...p, knownIds: Array.isArray(p.knownIds) ? p.knownIds : [] })
      else saved[index] = { ...saved[index], knownIds: Array.from(new Set([...saved[index].knownIds, ...(p.knownIds ?? [])])) }
    })
    return this.commit({ favorites, progress, playlists, saved })
  }

  /** A file went to the trash: drop it everywhere. */
  forget(key: string): LibraryState {
    const progress = { ...this.data.progress }
    delete progress[key]
    return this.commit({
      ...this.data,
      favorites: this.data.favorites.filter((k) => k !== key),
      progress,
      playlists: this.data.playlists.map((p) => (p.items.includes(key) ? { ...p, items: p.items.filter((k) => k !== key) } : p)),
    })
  }

  private editPlaylist(id: string, transform: (p: UserPlaylist) => UserPlaylist): LibraryState {
    return this.commit({ ...this.data, playlists: this.data.playlists.map((p) => (p.id === id ? transform(p) : p)) })
  }

  private commit(next: LibraryState): LibraryState {
    this.data = next
    this.persist()
    broadcast(IPC.libStateChanged, this.data)
    return this.data
  }

  private persist(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 600)
  }

  flush(): void {
    try {
      const tmp = this.file() + '.tmp'
      writeFileSync(tmp, JSON.stringify(this.data), 'utf8')
      renameSync(tmp, this.file())
    } catch (err) {
      logError('libraryState.save', err)
    }
  }
}

export const libraryState = new LibraryStateStore()

/** A playlist title as a folder name that Windows accepts. */
export function safeFolderName(name: string | null | undefined): string | null {
  if (!name) return null
  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '')
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) cleaned = '_' + cleaned
  return cleaned || null
}
