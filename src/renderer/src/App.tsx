import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Download, RefreshCw, TriangleAlert } from 'lucide-react'
import type { AppInfo, DownloadJob, DownloadMode, LibraryItem, Settings, TabId, UpdateStatus, YtdlpUpdateInfo } from '@shared/types'
import DownloadTab from './components/DownloadTab'
import LibraryTab from './components/LibraryTab'
import PlayerOverlay from './components/PlayerOverlay'
import SettingsTab from './components/SettingsTab'
import Sidebar from './components/Sidebar'
import StreamTab from './components/StreamTab'
import Toasts from './components/Toasts'
import { errorMessage, unwrap } from './lib/api'
import type { DownloadDraft, PlayerModel, ToastItem, ToastTone } from './lib/types'

const TAB_TITLES: Record<TabId, { title: string; sub: string }> = {
  stream: { title: 'Stream', sub: 'Play a YouTube link right here — no ads, no popups.' },
  download: { title: 'Download', sub: 'Save the whole video (with audio) or just the audio.' },
  library: { title: 'Library', sub: 'Everything in your downloads folder, ready to play.' },
  settings: { title: 'Settings', sub: 'Folders, quality defaults and the tools behind the app.' },
}

function TabPanel({ id, active, children }: { id: TabId; active: boolean; children: ReactNode }): ReactNode {
  // Panels stay mounted so a playing stream keeps playing while you browse other tabs.
  return (
    <div
      data-tab={id}
      data-active={active ? 'true' : 'false'}
      style={{ display: active ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {children}
    </div>
  )
}

export default function App(): ReactNode {
  const [tab, setTab] = useState<TabId>('stream')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [jobs, setJobs] = useState<DownloadJob[]>([])
  const [library, setLibrary] = useState<LibraryItem[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [libraryStale, setLibraryStale] = useState(false)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [toolUpdate, setToolUpdate] = useState<UpdateStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installingFfmpeg, setInstallingFfmpeg] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<YtdlpUpdateInfo | null>(null)
  const [player, setPlayer] = useState<PlayerModel | null>(null)
  const [draft, setDraft] = useState<DownloadDraft | null>(null)
  const [queue, setQueue] = useState<LibraryItem[]>([])
  const [queuePos, setQueuePos] = useState(-1)
  const toastId = useRef(0)
  const lastDir = useRef('')

  const pushToast = useCallback((message: string, tone: ToastTone = 'info') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, tone === 'error' ? 9000 : 4200)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const scanLibrary = useCallback(async () => {
    setLibraryBusy(true)
    try {
      const items = await unwrap(window.api.scanLibrary())
      setLibrary(items)
      setLibraryLoaded(true)
      setLibraryStale(false)
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    } finally {
      setLibraryBusy(false)
    }
  }, [pushToast])

  const refreshTools = useCallback(async () => {
    try {
      const tools = await unwrap(window.api.getToolStatus())
      setInfo((prev) => (prev ? { ...prev, ytdlp: tools.ytdlp, ffmpeg: tools.ffmpeg } : prev))
    } catch {
      /* status refresh is best effort */
    }
  }, [])

  // Coming back from the ffmpeg download page: pick up a fresh install without a manual recheck.
  useEffect(() => {
    const onFocus = (): void => void refreshTools()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshTools])

  const checkForUpdate = useCallback(async (force: boolean): Promise<YtdlpUpdateInfo | null> => {
    try {
      const next = await unwrap(window.api.checkYtdlpUpdate(force))
      setUpdateInfo(next)
      if (force && next.error) pushToast('Update check failed: ' + next.error, 'error')
      return next
    } catch (err) {
      if (force) pushToast('Update check failed: ' + errorMessage(err), 'error')
      return null
    }
  }, [pushToast])

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      try {
        const [appInfo, jobList] = await Promise.all([unwrap(window.api.getAppInfo()), unwrap(window.api.listJobs())])
        if (cancelled) return
        setInfo(appInfo)
        setSettings(appInfo.settings)
        setTab(appInfo.settings.lastTab)
        lastDir.current = appInfo.settings.downloadsDir
        setJobs(jobList)
        void checkForUpdate(false)
      } catch (err) {
        pushToast('Could not start the app: ' + errorMessage(err), 'error')
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [pushToast, checkForUpdate])

  useEffect(() => {
    const off = window.api.onJobProgress((payload) => {
      setJobs((prev) => {
        const next = prev.filter((job) => job.id !== payload.full.id)
        next.push(payload.full)
        return next.sort((a, b) => b.createdAt - a.createdAt)
      })
      if (payload.job.status === 'completed') setLibraryStale(true)
    })
    let clearTimer = 0
    const offTool = window.api.onToolStatus((status) => {
      setToolUpdate(status)
      window.clearTimeout(clearTimer)
      // The first-run auto-install happens in the main process, so pick up the result here.
      if (status.phase === 'done' || status.phase === 'error') {
        if (status.phase === 'done') void refreshTools()
        clearTimer = window.setTimeout(() => setToolUpdate(null), 5000)
      }
    })
    return () => {
      off()
      offTool()
      window.clearTimeout(clearTimer)
    }
  }, [refreshTools])

  useEffect(() => {
    if (tab !== 'library') return
    if (libraryLoaded && !libraryStale) return
    void scanLibrary()
  }, [tab, libraryLoaded, libraryStale, scanLibrary])

  useEffect(() => {
    const mode = settings?.theme ?? 'dark'
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = (): void => {
      const resolved = mode === 'system' ? (media.matches ? 'light' : 'dark') : mode
      document.documentElement.dataset.theme = resolved
    }
    apply()
    if (mode === 'system') {
      media.addEventListener('change', apply)
      return () => media.removeEventListener('change', apply)
    }
    return undefined
  }, [settings?.theme])

  const updateSettings = useCallback(async (patch: Partial<Settings>): Promise<Settings | null> => {
    try {
      const next = await unwrap(window.api.updateSettings(patch))
      setSettings(next)
      if (patch.downloadsDir && patch.downloadsDir !== lastDir.current) {
        lastDir.current = patch.downloadsDir
        setLibraryLoaded(false)
        setLibraryStale(true)
      }
      if ('ytdlpPath' in patch || 'ffmpegPath' in patch || 'proxy' in patch || 'cookiesFromBrowser' in patch) {
        void refreshTools()
      }
      return next
    } catch (err) {
      pushToast(errorMessage(err), 'error')
      return null
    }
  }, [pushToast, refreshTools])

  const changeTab = useCallback((next: TabId) => {
    setTab(next)
    void window.api.updateSettings({ lastTab: next })
  }, [])

  const installYtdlp = useCallback(async () => {
    setInstalling(true)
    setToolUpdate({ phase: 'checking', percent: 0, message: 'Starting download...' })
    try {
      const status = await unwrap(window.api.updateYtdlp())
      setInfo((prev) => (prev ? { ...prev, ytdlp: status } : prev))
      setUpdateInfo({ current: status.version, latest: status.version, updateAvailable: false, error: null, checkedAt: Date.now() })
      pushToast('yt-dlp ' + (status.version ?? '') + ' is ready to use.', 'success')
      if (settings && settings.ytdlpPath.trim()) {
        pushToast('Note: the custom yt-dlp path in Settings still takes precedence over the updated copy.', 'info')
      }
      void checkForUpdate(true)
    } catch (err) {
      pushToast('yt-dlp setup failed: ' + errorMessage(err), 'error')
    } finally {
      setInstalling(false)
      window.setTimeout(() => setToolUpdate(null), 5000)
    }
  }, [pushToast, settings, checkForUpdate])

  const installFfmpeg = useCallback(async () => {
    setInstallingFfmpeg(true)
    setToolUpdate({ phase: 'checking', tool: 'ffmpeg', percent: 0, message: 'Starting ffmpeg download...' })
    try {
      const status = await unwrap(window.api.installFfmpeg())
      setInfo((prev) => (prev ? { ...prev, ffmpeg: status } : prev))
      pushToast('ffmpeg ' + (status.version ?? '') + ' is ready to use.', 'success')
    } catch (err) {
      pushToast('ffmpeg setup failed: ' + errorMessage(err), 'error')
    } finally {
      setInstallingFfmpeg(false)
    }
  }, [pushToast])

  const playLibraryItem = useCallback((item: LibraryItem, list: LibraryItem[], position: number) => {
    setQueue(list)
    setQueuePos(position)
    setPlayer({
      title: item.title ?? item.name,
      subtitle: item.uploader,
      kind: item.kind,
      videoUrl: item.kind === 'video' ? item.mediaUrl : null,
      audioUrl: item.kind === 'audio' ? item.mediaUrl : null,
      separateAudio: false,
      absPath: item.absPath,
      sessionId: null,
      duration: item.duration,
    })
  }, [])

  const stepQueue = useCallback((delta: number) => {
    const next = queuePos + delta
    if (next < 0 || next >= queue.length) return
    playLibraryItem(queue[next], queue, next)
  }, [queue, queuePos, playLibraryItem])

  const closePlayer = useCallback(() => setPlayer(null), [])

  const sendToDownload = useCallback((url: string, mode: DownloadMode) => {
    setDraft({ url, mode, nonce: Date.now() })
    changeTab('download')
  }, [changeTab])

  const activeDownloads = useMemo(
    () => jobs.filter((job) => job.status === 'downloading' || job.status === 'processing' || job.status === 'queued').length,
    [jobs],
  )

  if (!info || !settings) {
    return (
      <div className="empty" style={{ height: '100vh' }}>
        <span className="spinner" />
        <p>Starting YTD Studio...</p>
      </div>
    )
  }

  const heading = TAB_TITLES[tab]
  const ytdlpMissing = !info.ytdlp.ok
  const ffmpegBusy = installingFfmpeg || (toolUpdate?.tool === 'ffmpeg' && (toolUpdate.phase === 'checking' || toolUpdate.phase === 'downloading'))

  return (
    <div className="app">
      <Sidebar
        tab={tab}
        onTab={changeTab}
        info={info}
        activeDownloads={activeDownloads}
        libraryCount={library.length}
        toolBusy={installing}
        ytdlpUpdate={!!(updateInfo && updateInfo.updateAvailable)}
      />
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{heading.title}</h1>
            <div className="sub">{heading.sub}</div>
          </div>
          <div className="topbar-actions">
            {updateInfo && updateInfo.updateAvailable ? (
              <button
                type="button"
                className="chip warn"
                disabled={installing}
                title={'Latest release: ' + (updateInfo.latest ?? '') + ' — currently on ' + (updateInfo.current ?? 'nothing')}
                onClick={() => void installYtdlp()}
              >
                <Download size={13} />
                <span>yt-dlp {updateInfo.latest} available</span>
              </button>
            ) : null}
            {toolUpdate ? (
              <span className="chip warn">
                <span className="spinner" />
                {toolUpdate.message}
              </span>
            ) : null}
            <button type="button" className="btn small" onClick={() => void refreshTools()}>
              <RefreshCw size={14} />
              <span>Recheck tools</span>
            </button>
          </div>
        </header>

        {ytdlpMissing ? (
          <div className="banner">
            <TriangleAlert size={16} style={{ color: 'var(--warn)' }} />
            <span className="grow">yt-dlp is not installed yet, so links cannot be analyzed or downloaded.</span>
            <button type="button" className="btn primary small" disabled={installing} onClick={() => void installYtdlp()}>
              <Download size={14} />
              <span>{installing ? 'Installing...' : 'Install yt-dlp'}</span>
            </button>
          </div>
        ) : null}

        {!info.ffmpeg.ok ? (
          <div className="banner">
            <TriangleAlert size={16} style={{ color: 'var(--warn)' }} />
            <span className="grow">
              ffmpeg is not installed. You need it for full-quality video (1080p and up) and for converting audio to MP3. The app can download it for you (about 115 MB).
            </span>
            <button type="button" className="btn primary small" disabled={ffmpegBusy} onClick={() => void installFfmpeg()}>
              <Download size={14} />
              <span>{ffmpegBusy ? 'Installing...' : 'Install ffmpeg'}</span>
            </button>
            <button type="button" className="btn small" onClick={() => void refreshTools()}>
              <RefreshCw size={14} />
              <span>Recheck</span>
            </button>
          </div>
        ) : null}

        <TabPanel id="stream" active={tab === 'stream'}>
          <StreamTab settings={settings} pushToast={pushToast} onDownload={sendToDownload} />
        </TabPanel>
        <TabPanel id="download" active={tab === 'download'}>
          <DownloadTab
            settings={settings}
            jobs={jobs}
            pushToast={pushToast}
            onSettingsChange={updateSettings}
            ytdlpReady={info.ytdlp.ok}
            ffmpegOk={info.ffmpeg.ok}
            ffmpegBusy={ffmpegBusy}
            onInstallFfmpeg={installFfmpeg}
            draft={draft}
          />
        </TabPanel>
        <TabPanel id="library" active={tab === 'library'}>
          <LibraryTab
            items={library}
            busy={libraryBusy}
            settings={settings}
            pushToast={pushToast}
            onRescan={() => void scanLibrary()}
            onPlay={playLibraryItem}
            onSettingsChange={updateSettings}
          />
        </TabPanel>
        <TabPanel id="settings" active={tab === 'settings'}>
          <SettingsTab
            info={info}
            settings={settings}
            installing={installing}
            toolUpdate={toolUpdate}
            pushToast={pushToast}
            onSettingsChange={updateSettings}
            onInstallYtdlp={installYtdlp}
            ffmpegBusy={ffmpegBusy}
            onInstallFfmpeg={installFfmpeg}
            onRefreshTools={refreshTools}
            updateInfo={updateInfo}
            onCheckUpdate={checkForUpdate}
          />
        </TabPanel>
      </div>

      {player ? (
        <PlayerOverlay
          model={player}
          onClose={closePlayer}
          onPrev={() => stepQueue(-1)}
          onNext={() => stepQueue(1)}
          hasPrev={queuePos > 0}
          hasNext={queuePos >= 0 && queuePos < queue.length - 1}
          onReveal={() => {
            if (player.absPath) void window.api.revealPath(player.absPath)
          }}
          onOpenExternal={() => {
            if (player.absPath) void window.api.openPath(player.absPath)
          }}
        />
      ) : null}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
