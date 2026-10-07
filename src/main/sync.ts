import type { SyncResult, ToastPayload } from '@shared/types'
import { IPC } from '@shared/ipc'
import { broadcast } from './bus'
import { downloads } from './downloads'
import { libraryState } from './library-state'
import { log, logError } from './logger'
import { settings } from './settings'
import { probe } from './ytdlp'

const running = new Set<string>()

/** Check a saved YouTube playlist (or channel) for videos added since the last sync and queue only those. */
export async function syncSaved(id: string): Promise<SyncResult> {
  const saved = libraryState.get().saved.find((p) => p.id === id)
  if (!saved) throw new Error('That playlist is no longer saved.')
  if (running.has(id)) return { title: saved.title, added: 0 }
  running.add(id)
  try {
    const meta = await probe(saved.url)
    const known = new Set(saved.knownIds)
    const added = meta.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => !!entry.id && !!entry.url && !known.has(entry.id))
    if (added.length) {
      downloads.createMany(
        added.map(({ entry, index }) => ({
          url: entry.url,
          videoId: entry.id,
          title: entry.title,
          uploader: entry.uploader,
          thumbnail: entry.thumbnail,
          duration: entry.duration,
          mode: saved.mode,
          height: saved.height,
          audioFormat: saved.audioFormat,
          folder: saved.folder,
          playlistIndex: index + 1,
          sponsorBlock: settings.get('sponsorBlock'),
        })),
      )
    }
    libraryState.markSynced(id, added.map(({ entry }) => entry.id))
    return { title: saved.title, added: added.length }
  } finally {
    running.delete(id)
  }
}

function toast(payload: ToastPayload): void {
  broadcast(IPC.notifyToast, payload)
}

let timer: NodeJS.Timeout | null = null

/** Sync every saved playlist whose last sync is older than the interval in Settings. */
async function autoSyncTick(): Promise<void> {
  const hours = settings.get('autoSyncHours')
  if (!hours) return
  const due = libraryState.get().saved.filter((p) => Date.now() - p.lastSync >= hours * 3600 * 1000)
  for (const playlist of due) {
    try {
      const result = await syncSaved(playlist.id)
      log('autosync', playlist.title, result.added)
      if (result.added) toast({ message: 'Auto-sync: ' + result.added + ' new video(s) from ' + result.title + ' queued.', tone: 'success' })
    } catch (err) {
      logError('autosync ' + playlist.title, err)
    }
  }
}

/** Check every 10 minutes (and shortly after start) whether anything is due. */
export function startAutoSync(): void {
  if (timer) return
  setTimeout(() => void autoSyncTick(), 20 * 1000)
  timer = setInterval(() => void autoSyncTick(), 10 * 60 * 1000)
}
