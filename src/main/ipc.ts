import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  DownloadRequest,
  DownloadJob,
  IpcResult,
  LibraryItem,
  Settings,
  StreamRequest,
  StreamSession,
  ToolStatus,
  ToolStatusBundle,
  UpdateStatus,
  VideoMeta,
  YtdlpUpdateInfo,
} from '@shared/types'
import { broadcast } from './bus'
import { downloads } from './downloads'
import { FFMPEG_DOWNLOAD_URL, ffmpegStatus, installFfmpeg, invalidateFfmpeg } from './ffmpeg'
import { deleteLibraryItem, scanLibrary } from './library'
import { logError } from './logger'
import { createStreamSession, dropStreamSession, getMediaPort } from './media-server'
import { binDir, defaultDownloadsDir, ensureDir } from './paths'
import { settings } from './settings'
import { clearProbeCache, describe, resolveStream } from './stream'
import { checkYtdlpUpdate, installYtdlp, invalidateBinary, ytdlpStatus } from './ytdlp'

function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function failure(error: unknown): IpcResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async function (_event, ...args: unknown[]) {
    try {
      return ok((await fn(...args)) as T)
    } catch (err) {
      logError('ipc:' + channel, err)
      return failure(err)
    }
  })
}

async function toolStatusBundle(fresh = false): Promise<ToolStatusBundle> {
  if (fresh) invalidateFfmpeg()
  return { ytdlp: await ytdlpStatus(), ffmpeg: ffmpegStatus() }
}

export function registerIpc(): void {
  handle(IPC.appInfo, async (): Promise<AppInfo> => {
    const tools = await toolStatusBundle()
    return {
      name: 'YTD Studio',
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
      platform: process.platform,
      isPackaged: app.isPackaged,
      mediaServerPort: getMediaPort(),
      downloadsDir: settings.get('downloadsDir'),
      defaultDownloadsDir: defaultDownloadsDir(),
      userDataDir: app.getPath('userData'),
      ytdlp: tools.ytdlp,
      ffmpeg: tools.ffmpeg,
      settings: settings.all(),
    }
  })

  handle(IPC.settingsGet, (): Settings => settings.all())

  handle(IPC.settingsUpdate, (patch: Partial<Settings>): Settings => {
    const next = settings.update(patch ?? {})
    if (patch && ('ytdlpPath' in patch || 'cookiesFromBrowser' in patch || 'proxy' in patch)) invalidateBinary()
    if (patch && 'ffmpegPath' in patch) invalidateFfmpeg()
    if (patch && 'downloadsDir' in patch) ensureDir(next.downloadsDir)
    clearProbeCache()
    return next
  })

  handle(IPC.settingsReset, (): Settings => {
    const next = settings.reset()
    invalidateBinary()
    invalidateFfmpeg()
    clearProbeCache()
    return next
  })

  handle(IPC.dialogPickFolder, async (defaultPath?: string): Promise<string | null> => {
    const focused = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Choose a folder',
      defaultPath: defaultPath || settings.get('downloadsDir'),
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    }
    const result = focused ? await dialog.showOpenDialog(focused, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  handle(IPC.dialogPickFile, async (defaultPath?: string): Promise<string | null> => {
    const focused = BrowserWindow.getFocusedWindow()
    const options = {
      title: 'Choose a file',
      defaultPath: defaultPath || undefined,
      properties: ['openFile'] as Array<'openFile'>,
    }
    const result = focused ? await dialog.showOpenDialog(focused, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  handle(IPC.toolsOpenFfmpegDownload, async (): Promise<true> => {
    await shell.openExternal(FFMPEG_DOWNLOAD_URL)
    return true
  })

  handle(IPC.shellReveal, async (absPath: string): Promise<true> => {
    shell.showItemInFolder(absPath)
    return true
  })

  handle(IPC.shellOpen, async (absPath: string): Promise<true> => {
    const error = await shell.openPath(absPath)
    if (error) throw new Error(error)
    return true
  })

  handle(IPC.clipboardRead, async (): Promise<string> => clipboard.readText())

  handle(IPC.probe, async (url: string): Promise<VideoMeta> => {
    if (!url || !url.trim()) throw new Error('Paste a YouTube link first.')
    return describe(url.trim())
  })

  handle(IPC.jobsList, (): DownloadJob[] => downloads.list())

  handle(IPC.jobsCreate, (input: DownloadRequest | DownloadRequest[]): DownloadJob[] => {
    const list = Array.isArray(input) ? input : [input]
    if (!list.length) throw new Error('Nothing to download.')
    return downloads.createMany(list)
  })

  handle(IPC.jobsCancel, (id: string): true => {
    downloads.cancel(id)
    return true
  })

  handle(IPC.jobsRemove, (id: string): true => {
    downloads.remove(id)
    return true
  })

  handle(IPC.jobsRetry, (id: string): true => {
    downloads.retry(id)
    return true
  })

  handle(IPC.jobsClearFinished, (): true => {
    downloads.clearFinished()
    return true
  })

  handle(IPC.libraryScan, (): Promise<LibraryItem[]> => scanLibrary())

  handle(IPC.libraryDelete, async (absPath: string): Promise<string[]> => {
    const trashed = await deleteLibraryItem(absPath)
    if (!trashed.length) throw new Error('Nothing could be moved to the trash.')
    return trashed
  })

  handle(IPC.streamResolve, async (req: StreamRequest): Promise<StreamSession> => {
    if (!req || !req.url) throw new Error('Paste a YouTube link first.')
    const resolved = await resolveStream({ ...req, url: req.url.trim() })
    return createStreamSession(resolved)
  })

  handle(IPC.streamRelease, (sessionId: string): true => {
    dropStreamSession(sessionId)
    return true
  })

  // Rechecking re-scans for ffmpeg so a just-installed copy is picked up without restarting.
  handle(IPC.toolsStatus, (): Promise<ToolStatusBundle> => toolStatusBundle(true))

  handle(IPC.toolsCheckUpdate, (force?: boolean): Promise<YtdlpUpdateInfo> => checkYtdlpUpdate(!!force))

  handle(IPC.toolsUpdateYtdlp, async (): Promise<ToolStatus> => {
    const status = await installYtdlp(function (update: UpdateStatus) {
      broadcast(IPC.appUpdateStatus, update)
    })
    return status
  })

  handle(IPC.toolsInstallFfmpeg, async (): Promise<ToolStatus> => {
    return installFfmpeg(function (update: UpdateStatus) {
      broadcast(IPC.appUpdateStatus, update)
    })
  })

  handle(IPC.toolsOpenBin, async (): Promise<true> => {
    const error = await shell.openPath(ensureDir(binDir()))
    if (error) throw new Error(error)
    return true
  })

  handle(IPC.notifyToast, (payload: unknown): true => {
    broadcast(IPC.notifyToast, payload)
    return true
  })
}
