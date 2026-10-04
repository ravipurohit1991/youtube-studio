import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { DesktopApi, JobProgressPayload, UpdateStatus } from '@shared/types'

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
