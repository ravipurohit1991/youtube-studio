import { BrowserWindow, app, dialog } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import type { BackupSummary, LibraryState, Settings, TasteProfile } from '@shared/types'
import { replaceTaste, taste } from './ai/taste'
import { libraryState } from './library-state'
import { settings } from './settings'

/** Settings that describe this machine (folders, tool locations) are not carried between computers. */
const LOCAL_ONLY: Array<keyof Settings> = ['downloadsDir', 'ytdlpPath', 'ffmpegPath', 'lastTab']

interface BackupFile {
  app: 'ytd-studio'
  version: string
  exportedAt: string
  settings: Partial<Settings>
  library: LibraryState
  taste: TasteProfile
}

function summary(path: string, library: LibraryState): BackupSummary {
  return {
    path,
    favorites: library.favorites.length,
    playlists: library.playlists.length,
    synced: library.saved.length,
    progress: Object.keys(library.progress).length,
  }
}

export async function exportBackup(): Promise<BackupSummary | null> {
  const window = BrowserWindow.getFocusedWindow()
  const stamp = new Date().toISOString().slice(0, 10)
  const options = {
    title: 'Save a backup',
    defaultPath: 'ytd-studio-backup-' + stamp + '.json',
    filters: [{ name: 'YTD Studio backup', extensions: ['json'] }],
  }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  const all = settings.all()
  LOCAL_ONLY.forEach((key) => delete (all as Partial<Settings>)[key])
  const library = libraryState.get()
  const file: BackupFile = {
    app: 'ytd-studio',
    version: app.getVersion(),
    exportedAt: new Date().toISOString(),
    settings: all,
    library,
    taste: taste(),
  }
  writeFileSync(result.filePath, JSON.stringify(file, null, 2), 'utf8')
  return summary(result.filePath, library)
}

/** Merge a backup into the current state: nothing that is already here is lost. */
export async function importBackup(): Promise<BackupSummary | null> {
  const window = BrowserWindow.getFocusedWindow()
  const options = {
    title: 'Restore a backup',
    properties: ['openFile'] as Array<'openFile'>,
    filters: [{ name: 'YTD Studio backup', extensions: ['json'] }],
  }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths.length) return null
  const path = result.filePaths[0]
  let parsed: Partial<BackupFile>
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<BackupFile>
  } catch {
    throw new Error('That file is not a YTD Studio backup (it is not valid JSON).')
  }
  if (parsed.app !== 'ytd-studio' || !parsed.library) throw new Error('That file is not a YTD Studio backup.')
  if (parsed.settings && typeof parsed.settings === 'object') {
    const patch = { ...parsed.settings }
    LOCAL_ONLY.forEach((key) => delete patch[key])
    settings.update(patch)
  }
  const merged = libraryState.merge(parsed.library)
  if (parsed.taste) replaceTaste(parsed.taste, true)
  return summary(path, merged)
}
