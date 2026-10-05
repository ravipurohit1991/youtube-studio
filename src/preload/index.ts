import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AiProgress, DesktopApi, JobProgressPayload, LibraryState, UpdateStatus } from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

const api: DesktopApi = {
  getAppInfo: () => invoke(IPC.appInfo),
  getSettings: () => invoke(IPC.settingsGet),
  updateSettings: (patch) => invoke(IPC.settingsUpdate, patch),
  resetSettings: () => invoke(IPC.settingsReset),
  pickFolder: (defaultPath) => invoke(IPC.dialogPickFolder, defaultPath),
  revealPath: (absPath) => invoke(IPC.shellReveal, absPath),
  openPath: (absPath) => invoke(IPC.shellOpen, absPath),
  readClipboard: () => invoke(IPC.clipboardRead),
  probe: (url) => invoke(IPC.probe, url),
  listJobs: () => invoke(IPC.jobsList),
  createJobs: (reqs) => invoke(IPC.jobsCreate, reqs),
  cancelJob: (id) => invoke(IPC.jobsCancel, id),
  removeJob: (id) => invoke(IPC.jobsRemove, id),
  retryJob: (id) => invoke(IPC.jobsRetry, id),
  clearFinishedJobs: () => invoke(IPC.jobsClearFinished),
  scanLibrary: () => invoke(IPC.libraryScan),
  deleteLibraryItem: (absPath) => invoke(IPC.libraryDelete, absPath),
  resolveStream: (req) => invoke(IPC.streamResolve, req),
  releaseStream: (sessionId) => invoke(IPC.streamRelease, sessionId),
  getToolStatus: () => invoke(IPC.toolsStatus),
  checkYtdlpUpdate: (force) => invoke(IPC.toolsCheckUpdate, force),
  updateYtdlp: () => invoke(IPC.toolsUpdateYtdlp),
  installFfmpeg: () => invoke(IPC.toolsInstallFfmpeg),
  openBinFolder: () => invoke(IPC.toolsOpenBin),
  openFfmpegDownload: () => invoke(IPC.toolsOpenFfmpegDownload),
  pickFile: (defaultPath) => invoke(IPC.dialogPickFile, defaultPath),
  getLibraryState: () => invoke(IPC.libState),
  toggleFavorite: (key) => invoke(IPC.libToggleFavorite, key),
  saveProgress: (key, position, duration) => invoke(IPC.libSaveProgress, key, position, duration),
  setWatched: (key, watched) => invoke(IPC.libSetWatched, key, watched),
  createPlaylist: (name, items) => invoke(IPC.libCreatePlaylist, name, items),
  renamePlaylist: (id, name) => invoke(IPC.libRenamePlaylist, id, name),
  deletePlaylist: (id) => invoke(IPC.libDeletePlaylist, id),
  addToPlaylist: (id, keys) => invoke(IPC.libAddToPlaylist, id, keys),
  removeFromPlaylist: (id, key) => invoke(IPC.libRemoveFromPlaylist, id, key),
  movePlaylistItem: (id, from, to) => invoke(IPC.libMovePlaylistItem, id, from, to),
  savePlaylist: (playlist) => invoke(IPC.libSavePlaylist, playlist),
  removeSavedPlaylist: (id) => invoke(IPC.libRemoveSaved, id),
  syncPlaylist: (id) => invoke(IPC.libSyncPlaylist, id),
  aiStatus: () => invoke(IPC.aiStatus),
  aiSetKey: (key) => invoke(IPC.aiSetKey, key),
  aiClearKey: () => invoke(IPC.aiClearKey),
  aiListModels: () => invoke(IPC.aiListModels),
  aiTest: () => invoke(IPC.aiTest),
  aiDiscover: (req) => invoke(IPC.aiDiscover, req),
  aiSummarize: (req) => invoke(IPC.aiSummarize, req),
  aiAsk: (req) => invoke(IPC.aiAsk, req),
  aiOrganize: (requestId) => invoke(IPC.aiOrganize, requestId),
  aiCancel: (requestId) => invoke(IPC.aiCancel, requestId),
  aiTaste: () => invoke(IPC.aiTaste),
  aiTasteUpdate: (action) => invoke(IPC.aiTasteUpdate, action),
  onAiProgress: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: AiProgress): void => cb(payload)
    ipcRenderer.on(IPC.aiProgress, listener)
    return function () {
      ipcRenderer.removeListener(IPC.aiProgress, listener)
    }
  },
  onLibraryState: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: LibraryState): void => cb(payload)
    ipcRenderer.on(IPC.libStateChanged, listener)
    return function () {
      ipcRenderer.removeListener(IPC.libStateChanged, listener)
    }
  },
  onJobProgress: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: JobProgressPayload): void => cb(payload)
    ipcRenderer.on(IPC.jobsProgress, listener)
    return function () {
      ipcRenderer.removeListener(IPC.jobsProgress, listener)
    }
  },
  onToolStatus: (cb) => {
    const listener = (_event: IpcRendererEvent, payload: UpdateStatus): void => cb(payload)
    ipcRenderer.on(IPC.appUpdateStatus, listener)
    return function () {
      ipcRenderer.removeListener(IPC.appUpdateStatus, listener)
    }
  },
}

contextBridge.exposeInMainWorld('api', api)
