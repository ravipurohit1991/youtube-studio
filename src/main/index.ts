import { app, BrowserWindow, Menu, Notification, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { DownloadJob, UpdateStatus } from '@shared/types'
import { registerBroadcaster } from './bus'
import { downloads } from './downloads'
import { ffmpegStatus, installFfmpeg } from './ffmpeg'
import { registerIpc } from './ipc'
import { initLogger, log, logError } from './logger'
import { libraryState } from './library-state'
import { startMediaServer, stopMediaServer } from './media-server'
import { startAutoSync } from './sync'
import { settings } from './settings'
import { installYtdlp, resolveYtdlp } from './ytdlp'

const MEDIA_PORT = 47821
let mainWindow: BrowserWindow | null = null

// Tests and screenshots run against a throwaway data folder (Windows ignores APPDATA for this).
if (process.env.YTD_USER_DATA) app.setPath('userData', process.env.YTD_USER_DATA)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    title: 'YTD Studio',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  mainWindow.on('ready-to-show', function () {
    mainWindow?.show()
  })

  mainWindow.on('closed', function () {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(function (details) {
    if (details.url.indexOf('http') === 0) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    if (input.key === 'F12' || (input.control && input.shift && key === 'i')) {
      mainWindow?.webContents.toggleDevTools()
      event.preventDefault()
    }
    if (input.control && key === 'r') {
      mainWindow?.webContents.reload()
      event.preventDefault()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let lastBar = -2

/** Mirror the queue on the taskbar button: a progress bar while downloading, paused (yellow) when stopped. */
function updateTaskbar(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { fraction, active, paused } = downloads.summary()
  const value = fraction === null ? -1 : Math.round(fraction * 100) / 100
  if (value === lastBar) return
  lastBar = value
  if (value < 0 && paused > 0) mainWindow.setProgressBar(1, { mode: 'paused' })
  else mainWindow.setProgressBar(value, { mode: active ? 'normal' : 'none' })
}

/** Windows notification for a finished or failed download, only when the app is not in front. */
function notifyFinished(job: DownloadJob): void {
  if (!settings.get('notifyOnComplete') || !Notification.isSupported()) return
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) return
  const ok = job.status === 'completed'
  const note = new Notification({
    title: ok ? 'Download finished' : 'Download failed',
    body: job.title + (ok ? '' : '\n' + (job.error ?? '').slice(0, 140)),
    silent: !ok,
  })
  note.on('click', function () {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    if (ok && job.outputPath) shell.showItemInFolder(job.outputPath)
  })
  note.show()
}

function reportUpdate(status: UpdateStatus): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.appUpdateStatus, status)
}

/** First run: fetch yt-dlp so downloads work without any manual setup. */
async function ensureYtdlp(): Promise<void> {
  const binary = resolveYtdlp()
  if (binary.source !== 'missing') {
    log('yt-dlp present at', binary.path, '(' + binary.source + ')')
    return
  }
  log('yt-dlp missing, downloading a copy')
  try {
    await installYtdlp(reportUpdate)
  } catch (err) {
    logError('ensureYtdlp', err)
    reportUpdate({
      phase: 'error',
      percent: 0,
      message: 'Could not download yt-dlp automatically. Open Settings to retry or set a path manually.',
    })
  }
}

/** First run: fetch ffmpeg (joins 1080p+ streams, converts audio). Failure is non-fatal; the UI offers a retry. */
async function ensureFfmpeg(): Promise<void> {
  if (ffmpegStatus().ok) {
    log('ffmpeg present at', ffmpegStatus().path)
    return
  }
  log('ffmpeg missing, downloading a copy')
  try {
    await installFfmpeg(reportUpdate)
  } catch (err) {
    logError('ensureFfmpeg', err)
    reportUpdate({
      phase: 'error',
      percent: 0,
      message: 'Could not download ffmpeg automatically. Use "Install ffmpeg" to retry.',
    })
  }
}

async function bootstrap(): Promise<void> {
  initLogger()
  log('YTD Studio starting, version', app.getVersion())
  settings.load()
  downloads.init()
  libraryState.load()
  if (process.platform === 'win32') app.setAppUserModelId('com.ytdstudio.desktop')
  let taskbarTimer: NodeJS.Timeout | null = null
  downloads.setEvents({
    onChange: function () {
      if (taskbarTimer) return
      taskbarTimer = setTimeout(function () {
        taskbarTimer = null
        updateTaskbar()
      }, 400)
    },
    onFinish: notifyFinished,
  })
  registerBroadcaster(function () {
    return BrowserWindow.getAllWindows().map(function (win) { return win.webContents })
  })
  const port = await startMediaServer(MEDIA_PORT)
  log('media server port', port)
  registerIpc()
  Menu.setApplicationMenu(null)
  createWindow()
  startAutoSync()
  setTimeout(function () {
    ensureYtdlp()
      .then(ensureFfmpeg)
      .catch(function (err) { logError('ensureTools', err) })
  }, 1200)
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', function () {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', function () {
    libraryState.flush()
  })

  app.on('window-all-closed', function () {
    libraryState.flush()
    stopMediaServer()
    if (process.platform !== 'darwin') app.quit()
  })

  app.whenReady()
    .then(bootstrap)
    .catch(function (err) {
      logError('bootstrap', err)
      app.quit()
    })
}
