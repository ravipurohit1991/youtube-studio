import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArchiveRestore,
  CircleFadingArrowUp,
  ClipboardPaste,
  Download,
  FolderOpen,
  FolderSync,
  House,
  Library,
  Link2,
  ListVideo,
  Moon,
  Music,
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Sparkles,
  Sun,
  TriangleAlert,
} from 'lucide-react'
import type { AccentName, AiStatus, AppInfo, DownloadJob, DownloadMode, JobStatus, LibraryItem, LibraryState, SavedPlaylist, Settings, TabId, UpdateStatus, YtdlpUpdateInfo } from '@shared/types'
import AddToPlaylist from './components/AddToPlaylist'
import ClipboardPrompt from './components/ClipboardPrompt'
import CommandPalette, { type PaletteCommand } from './components/CommandPalette'
import DiscoverTab from './components/DiscoverTab'
import HomeTab from './components/HomeTab'
import SmartPlaylists from './components/SmartPlaylists'
import PlaylistsTab from './components/PlaylistsTab'
import DownloadTab from './components/DownloadTab'
import LibraryTab from './components/LibraryTab'
import PlayerOverlay from './components/PlayerOverlay'
import SettingsTab from './components/SettingsTab'
import Sidebar, { TAB_ORDER } from './components/Sidebar'
import StreamTab from './components/StreamTab'
import Toasts from './components/Toasts'
import { Kbd } from './components/common'
import { errorMessage, unwrap } from './lib/api'
import { findYouTubeUrl, looksLikeCollection } from './lib/format'
import { makeQueue, stepped, withShuffle } from './lib/queue'
import type { DownloadDraft, LinkDraft, PlayQueue, PushToast, StreamDraft, ToastItem } from './lib/types'

const TAB_TITLES: Record<TabId, { title: string; sub: string }> = {
  home: { title: 'Home', sub: 'Paste a link to watch or save it. Pick up where you left off.' },
  discover: { title: 'Discover', sub: 'Your own YouTube algorithm: say what you want, AI finds and ranks it for you.' },
  stream: { title: 'Stream', sub: 'Play a YouTube link right here — no ads, no popups.' },
  download: { title: 'Download', sub: 'Save the whole video (with audio) or just the audio. Follow playlists and channels.' },
  library: { title: 'Library', sub: 'Everything you downloaded: pick up where you left off, favorite, sort into playlists.' },
  playlists: { title: 'Playlists', sub: 'Downloaded YouTube playlists (kept in sync if you like) and playlists you made.' },
  settings: { title: 'Settings', sub: 'Make it yours: look, downloads, playback, AI and the tools behind the app.' },
}

const ACCENT_NAMES: AccentName[] = ['crimson', 'violet', 'ocean', 'emerald', 'amber', 'rose']

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

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const PENDING: JobStatus[] = ['queued', 'downloading', 'processing']

export default function App(): ReactNode {
  const [tab, setTab] = useState<TabId>('home')
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
  const [playQueue, setPlayQueue] = useState<PlayQueue | null>(null)
  const [draft, setDraft] = useState<DownloadDraft | null>(null)
  const [libState, setLibState] = useState<LibraryState>({ favorites: [], progress: {}, playlists: [], saved: [] })
  const [addKeys, setAddKeys] = useState<string[] | null>(null)
  const [syncing, setSyncing] = useState<string[]>([])
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  const [streamDraft, setStreamDraft] = useState<StreamDraft | null>(null)
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null)
  const [smartOpen, setSmartOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const toastId = useRef(0)
  const lastDir = useRef('')
  const lastClip = useRef<string | null>(null)
  const statuses = useRef(new Map<string, JobStatus>())
  const batchDone = useRef(0)
  const lastErrorToast = useRef(0)
  const libraryRef = useRef<LibraryItem[]>([])
  libraryRef.current = library

  const pushToast = useCallback<PushToast>((message, tone = 'info', options) => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev.slice(-4), { id, message, tone, actions: options?.actions }])
    const duration = options?.duration ?? (options?.actions?.length ? 8000 : tone === 'error' ? 9000 : 4200)
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, duration)
  }, [])

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const scanLibrary = useCallback(async (): Promise<LibraryItem[]> => {
    setLibraryBusy(true)
    try {
      const items = await unwrap(window.api.scanLibrary())
      setLibrary(items)
      setLibraryLoaded(true)
      setLibraryStale(false)
      return items
    } catch (err) {
      pushToast(errorMessage(err), 'error')
      return libraryRef.current
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
        const [appInfo, jobList, state, ai] = await Promise.all([
          unwrap(window.api.getAppInfo()),
          unwrap(window.api.listJobs()),
          unwrap(window.api.getLibraryState()),
          unwrap(window.api.aiStatus()).catch(() => null),
        ])
        if (cancelled) return
        setAiStatus(ai)
        setLibState(state)
        setInfo(appInfo)
        setSettings(appInfo.settings)
        setTab(appInfo.settings.lastTab)
        lastDir.current = appInfo.settings.downloadsDir
        jobList.forEach((job) => statuses.current.set(job.id, job.status))
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

  /** Play a finished download in the app's player (rescans first so the file is in the library). */
  const playFile = useCallback(
    async (absPath: string) => {
      let item = libraryRef.current.find((entry) => entry.absPath === absPath)
      if (!item) item = (await scanLibrary()).find((entry) => entry.absPath === absPath)
      if (item) setPlayQueue((previous) => makeQueue([item as LibraryItem], 0, false, previous?.repeat ?? 'off'))
      else void window.api.openPath(absPath)
    },
    [scanLibrary],
  )

  const changeTab = useCallback((next: TabId) => {
    setTab(next)
    void window.api.updateSettings({ lastTab: next })
  }, [])

  // Finished downloads: a toast with Play / Show in folder for single ones, one summary for a batch.
  const onJobChange = useCallback(
    (job: DownloadJob, all: DownloadJob[]) => {
      const before = statuses.current.get(job.id)
      statuses.current.set(job.id, job.status)
      if (before === job.status || !before) return
      const stillPending = all.some((j) => j.id !== job.id && PENDING.includes(j.status))
      if (job.status === 'completed') {
        batchDone.current += 1
        if (stillPending) return
        const count = batchDone.current
        batchDone.current = 0
        if (count > 1) {
          pushToast('All ' + count + ' downloads finished.', 'success', { actions: [{ label: 'Open Library', onClick: () => changeTab('library') }] })
        } else if (job.outputPath) {
          const path = job.outputPath
          pushToast('Downloaded "' + job.title + '"', 'success', {
            actions: [
              { label: 'Play', onClick: () => void playFile(path) },
              { label: 'Show in folder', onClick: () => void window.api.revealPath(path) },
            ],
          })
        }
      } else if (job.status === 'error') {
        if (!stillPending) batchDone.current = 0
        const now = Date.now()
        if (now - lastErrorToast.current < 4000) return
        lastErrorToast.current = now
        pushToast('Download failed: ' + job.title, 'error', {
          actions: [
            { label: 'Retry', onClick: () => void window.api.retryJob(job.id) },
            { label: 'Details', onClick: () => changeTab('download') },
          ],
        })
      }
    },
    [pushToast, playFile, changeTab],
  )

  useEffect(() => {
    const off = window.api.onJobProgress((payload) => {
      setJobs((prev) => {
        const next = prev.filter((job) => job.id !== payload.full.id)
        if (!payload.removed) next.push(payload.full)
        const sorted = next.sort((a, b) => b.createdAt - a.createdAt)
        if (!payload.removed) window.setTimeout(() => onJobChange(payload.full, sorted), 0)
        else statuses.current.delete(payload.full.id)
        return sorted
      })
      if (payload.job.status === 'completed') setLibraryStale(true)
    })
    const offLib = window.api.onLibraryState((state) => setLibState(state))
    const offToast = window.api.onToast((toast) => pushToast(toast.message, toast.tone, { actions: [{ label: 'View queue', onClick: () => changeTab('download') }] }))
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
      offLib()
      offToast()
      offTool()
      window.clearTimeout(clearTimer)
    }
  }, [refreshTools, onJobChange, pushToast, changeTab])

  useEffect(() => {
    if (tab !== 'library' && tab !== 'playlists' && tab !== 'home') return
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

  useEffect(() => {
    document.documentElement.dataset.accent = settings?.accent ?? 'crimson'
  }, [settings?.accent])

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
      // {} is sent after "Reset all settings", which also resets the AI server and model.
      if (!Object.keys(patch).length || 'aiHost' in patch || 'aiModel' in patch) {
        void unwrap(window.api.aiStatus()).then(setAiStatus).catch(() => undefined)
      }
      return next
    } catch (err) {
      pushToast(errorMessage(err), 'error')
      return null
    }
  }, [pushToast, refreshTools])

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

  /** Play list starting at index (-1 with shuffle: a random first item). */
  const playItems = useCallback((list: LibraryItem[], index: number, shuffle = false) => {
    if (!list.length) return
    setPlayQueue((previous) => makeQueue(list, index, shuffle, previous?.repeat ?? 'off'))
  }, [])

  const stepQueue = useCallback((delta: number) => {
    setPlayQueue((previous) => (previous ? stepped(previous, delta) ?? previous : previous))
  }, [])

  const closePlayer = useCallback(() => {
    setPlayQueue(null)
    // Progress updates while playing are quiet; refresh badges and "continue watching" now.
    void unwrap(window.api.getLibraryState()).then(setLibState).catch(() => undefined)
  }, [])

  const syncPlaylist = useCallback(async (playlist: SavedPlaylist) => {
    setSyncing((prev) => (prev.includes(playlist.id) ? prev : [...prev, playlist.id]))
    try {
      const result = await unwrap(window.api.syncPlaylist(playlist.id))
      pushToast(result.added ? result.title + ': ' + result.added + ' new video(s) queued.' : result.title + ' is up to date.', result.added ? 'success' : 'info')
    } catch (err) {
      pushToast('Sync failed for ' + playlist.title + ': ' + errorMessage(err), 'error')
    } finally {
      setSyncing((prev) => prev.filter((id) => id !== playlist.id))
    }
  }, [pushToast])

  const syncAll = useCallback(() => {
    libState.saved.forEach((playlist) => void syncPlaylist(playlist))
  }, [libState.saved, syncPlaylist])

  const sendToDownload = useCallback((url: string, mode: DownloadMode) => {
    setDraft({ url, mode, nonce: Date.now() })
    changeTab('download')
  }, [changeTab])

  const playInStream = useCallback((url: string, startAt?: number, audioOnly?: boolean) => {
    setStreamDraft({ url, startAt, audioOnly, nonce: Date.now() })
    changeTab('stream')
  }, [changeTab])

  const openOnHome = useCallback((url: string) => {
    setLinkDraft({ url, nonce: Date.now() })
    changeTab('home')
  }, [changeTab])

  /** Queue a link with the defaults from Settings, no questions asked. */
  const quickDownload = useCallback(
    async (url: string, mode: DownloadMode) => {
      if (!settings) return
      if (looksLikeCollection(url)) {
        sendToDownload(url, mode)
        return
      }
      try {
        await unwrap(
          window.api.createJobs([
            {
              url,
              mode,
              title: 'Queued link',
              height: mode === 'audio_only' ? null : settings.preferredHeight,
              audioFormat: settings.audioFormat,
              audioQuality: settings.audioQuality,
              sponsorBlock: settings.sponsorBlock,
            },
          ]),
        )
        pushToast(mode === 'audio_only' ? 'Downloading the audio.' : 'Download started.', 'success', { actions: [{ label: 'View queue', onClick: () => changeTab('download') }] })
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [settings, pushToast, changeTab, sendToDownload],
  )

  const openAiSettings = useCallback(() => {
    changeTab('settings')
    window.setTimeout(() => document.getElementById('ai-settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [changeTab])

  const openSmartPlaylists = useCallback(() => {
    if (!aiStatus?.ready) {
      pushToast('Set up AI in Settings first: add your Ollama API key and pick a model.', 'info')
      openAiSettings()
      return
    }
    setSmartOpen(true)
  }, [aiStatus?.ready, pushToast, openAiSettings])

  const pasteLink = useCallback(async () => {
    try {
      const url = findYouTubeUrl(await unwrap(window.api.readClipboard()))
      if (url) openOnHome(url)
      else pushToast('There is no YouTube link on the clipboard.', 'info')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }, [openOnHome, pushToast])

  const bulk = useCallback(
    async (call: () => Promise<{ ok: true; data: number } | { ok: false; error: string }>, done: (n: number) => string) => {
      try {
        pushToast(done(await unwrap(call())), 'info')
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  const backup = useCallback(
    async (kind: 'export' | 'import') => {
      try {
        const result = await unwrap(kind === 'export' ? window.api.exportBackup() : window.api.importBackup())
        if (!result) return
        if (kind === 'import') {
          setSettings(await unwrap(window.api.getSettings()))
          setLibState(await unwrap(window.api.getLibraryState()))
        }
        pushToast(
          (kind === 'export' ? 'Backup saved' : 'Backup restored') + ': ' + result.favorites + ' favorites, ' + result.playlists + ' playlists, ' + result.synced + ' followed.',
          'success',
        )
      } catch (err) {
        pushToast(errorMessage(err), 'error')
      }
    },
    [pushToast],
  )

  // Ctrl+K palette, Ctrl+1..7 tabs, Ctrl+V anywhere outside a text field opens a YouTube link.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      } else if (/^[1-7]$/.test(key) && !playQueue) {
        event.preventDefault()
        changeTab(TAB_ORDER[Number(key) - 1])
      } else if (key === ',') {
        event.preventDefault()
        changeTab('settings')
      }
    }
    const onPaste = (event: ClipboardEvent): void => {
      if (isTyping(event.target) || playQueue || paletteOpen) return
      const url = findYouTubeUrl(event.clipboardData?.getData('text') ?? '')
      if (!url) return
      event.preventDefault()
      lastClip.current = url
      setClipUrl(null)
      openOnHome(url)
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('paste', onPaste)
    }
  }, [changeTab, openOnHome, playQueue, paletteOpen])

  // Coming back to the window: pick up freshly installed tools and offer a copied YouTube link.
  useEffect(() => {
    const check = async (): Promise<void> => {
      void refreshTools()
      if (!settings?.watchClipboard) return
      try {
        const url = findYouTubeUrl(await unwrap(window.api.readClipboard()))
        if (url && url !== lastClip.current) {
          lastClip.current = url
          setClipUrl(url)
        }
      } catch {
        /* clipboard access is best effort */
      }
    }
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    if (settings?.watchClipboard && info) void check()
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTools, settings?.watchClipboard, !!info])

  // Drop a link anywhere on the window.
  useEffect(() => {
    let depth = 0
    const hasText = (event: DragEvent): boolean => !!event.dataTransfer && Array.from(event.dataTransfer.types).some((t) => t === 'text/uri-list' || t === 'text/plain')
    const onEnter = (event: DragEvent): void => {
      if (!hasText(event)) return
      depth += 1
      setDragging(true)
    }
    const onLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const onOver = (event: DragEvent): void => {
      if (hasText(event)) event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      depth = 0
      setDragging(false)
      const text = event.dataTransfer?.getData('text/uri-list') || event.dataTransfer?.getData('text/plain') || ''
      const url = findYouTubeUrl(text)
      if (!url) return
      event.preventDefault()
      openOnHome(url)
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [openOnHome])

  const activeDownloads = useMemo(() => jobs.filter((job) => PENDING.includes(job.status)).length, [jobs])
  const downloadFraction = useMemo(() => {
    const pending = jobs.filter((job) => PENDING.includes(job.status))
    if (!pending.length) return null
    return pending.reduce((sum, job) => sum + (job.status === 'queued' ? 0 : job.percent), 0) / (pending.length * 100)
  }, [jobs])

  const dismissClip = useCallback(() => setClipUrl(null), [])

  const commands = useMemo<PaletteCommand[]>(() => {
    const nav: PaletteCommand[] = TAB_ORDER.map((id, index) => ({
      id: 'tab:' + id,
      group: 'Go to',
      label: TAB_TITLES[id].title,
      keywords: TAB_TITLES[id].sub,
      icon: id === 'home' ? <House size={16} /> : id === 'discover' ? <Sparkles size={16} /> : id === 'stream' ? <Play size={16} /> : id === 'download' ? <Download size={16} /> : id === 'library' ? <Library size={16} /> : id === 'playlists' ? <ListVideo size={16} /> : <SettingsIcon size={16} />,
      meta: <Kbd keys={'Ctrl+' + (index + 1)} />,
      run: () => changeTab(id),
    }))
    const dark = document.documentElement.dataset.theme !== 'light'
    const actions: PaletteCommand[] = [
      { id: 'paste', group: 'Actions', label: 'Open the link on the clipboard', keywords: 'paste url', icon: <ClipboardPaste size={16} />, meta: <Kbd keys="Ctrl+V" />, run: () => void pasteLink() },
      { id: 'pause-all', group: 'Actions', label: 'Pause all downloads', icon: <Pause size={16} />, run: () => void bulk(() => window.api.pauseAll(), (n) => (n ? n + ' download(s) paused.' : 'Nothing to pause.')) },
      { id: 'resume-all', group: 'Actions', label: 'Resume all downloads', icon: <Play size={16} />, run: () => void bulk(() => window.api.resumeAll(), (n) => (n ? n + ' download(s) resumed.' : 'Nothing is paused.')) },
      { id: 'retry-failed', group: 'Actions', label: 'Retry failed downloads', icon: <RotateCcw size={16} />, run: () => void bulk(() => window.api.retryFailed(), (n) => (n ? n + ' download(s) retried.' : 'No failed downloads.')) },
      { id: 'sync-all', group: 'Actions', label: 'Sync all followed playlists and channels', keywords: 'subscriptions update', icon: <FolderSync size={16} />, run: syncAll },
      { id: 'open-folder', group: 'Actions', label: 'Open the downloads folder', keywords: 'explorer files', icon: <FolderOpen size={16} />, run: () => settings && void window.api.openPath(settings.downloadsDir) },
      { id: 'rescan', group: 'Actions', label: 'Rescan the library', icon: <RefreshCw size={16} />, run: () => void scanLibrary() },
      { id: 'smart', group: 'Actions', label: 'Make smart playlists with AI', icon: <Sparkles size={16} />, run: openSmartPlaylists },
      { id: 'theme', group: 'Look', label: dark ? 'Switch to light theme' : 'Switch to dark theme', keywords: 'appearance mode', icon: dark ? <Sun size={16} /> : <Moon size={16} />, run: () => void updateSettings({ theme: dark ? 'light' : 'dark' }) },
      ...ACCENT_NAMES.map<PaletteCommand>((accent) => ({
        id: 'accent:' + accent,
        group: 'Look',
        label: 'Accent color: ' + accent[0].toUpperCase() + accent.slice(1),
        keywords: 'color theme',
        icon: <Palette size={16} />,
        meta: settings?.accent === accent ? 'current' : undefined,
        run: () => void updateSettings({ accent }),
      })),
      { id: 'ytdlp-update', group: 'Maintenance', label: 'Check for a yt-dlp update', icon: <CircleFadingArrowUp size={16} />, run: () => void checkForUpdate(true).then((r) => r && !r.error && pushToast(r.updateAvailable ? 'yt-dlp ' + r.latest + ' is available.' : 'yt-dlp is up to date.', 'info')) },
      { id: 'backup', group: 'Maintenance', label: 'Back up favorites, playlists and settings', keywords: 'export', icon: <Save size={16} />, run: () => void backup('export') },
      { id: 'restore', group: 'Maintenance', label: 'Restore a backup', keywords: 'import', icon: <ArchiveRestore size={16} />, run: () => void backup('import') },
    ]
    return [...nav, ...actions]
  }, [changeTab, pasteLink, bulk, syncAll, settings, scanLibrary, openSmartPlaylists, updateSettings, checkForUpdate, pushToast, backup])

  const linkCommands = useCallback(
    (url: string): PaletteCommand[] => {
      const collection = looksLikeCollection(url)
      const list: PaletteCommand[] = [
        { id: 'link-open', group: 'This link', label: collection ? 'Open this playlist or channel' : 'Show options for this link', icon: <Link2 size={16} />, run: () => openOnHome(url) },
      ]
      if (!collection) {
        list.push(
          { id: 'link-watch', group: 'This link', label: 'Watch it now', icon: <Play size={16} />, run: () => playInStream(url) },
          { id: 'link-video', group: 'This link', label: 'Download the video', icon: <Download size={16} />, run: () => void quickDownload(url, 'video_audio') },
          { id: 'link-audio', group: 'This link', label: 'Download the audio', icon: <Music size={16} />, run: () => void quickDownload(url, 'audio_only') },
        )
      }
      list.push({ id: 'link-options', group: 'This link', label: 'All download options…', icon: <SlidersHorizontal size={16} />, run: () => sendToDownload(url, settings?.defaultMode ?? 'video_audio') })
      return list
    },
    [openOnHome, playInStream, quickDownload, sendToDownload, settings?.defaultMode],
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
  const dark = document.documentElement.dataset.theme !== 'light'

  return (
    <div className="app">
      <Sidebar
        tab={tab}
        onTab={changeTab}
        info={info}
        activeDownloads={activeDownloads}
        downloadFraction={downloadFraction}
        libraryCount={library.length}
        playlistCount={libState.playlists.length + new Set(library.map((item) => item.folder).filter(Boolean)).size}
        toolBusy={installing}
        ytdlpUpdate={!!(updateInfo && updateInfo.updateAvailable)}
        aiStatus={aiStatus}
        onOpenPalette={() => setPaletteOpen(true)}
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
                className="chip warn chip-btn"
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
            <button type="button" className="btn small ghost icon" title="Search and commands (Ctrl+K)" onClick={() => setPaletteOpen(true)}>
              <Search size={16} />
            </button>
            <button type="button" className="btn small ghost icon" title={dark ? 'Light theme' : 'Dark theme'} onClick={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}>
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button type="button" className="btn small ghost icon" title="Recheck tools" onClick={() => void refreshTools()}>
              <RefreshCw size={16} />
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
              ffmpeg is not installed. You need it for full-quality video (1080p and up), clips, SponsorBlock and converting audio to MP3. The app can download it for you (about 115 MB).
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

        <TabPanel id="home" active={tab === 'home'}>
          <HomeTab
            settings={settings}
            jobs={jobs}
            library={library}
            libState={libState}
            aiStatus={aiStatus}
            ytdlpReady={info.ytdlp.ok}
            ffmpegOk={info.ffmpeg.ok}
            draft={linkDraft}
            pushToast={pushToast}
            onTab={changeTab}
            onPlay={playItems}
            onStream={playInStream}
            onDownloadOptions={sendToDownload}
          />
        </TabPanel>
        <TabPanel id="discover" active={tab === 'discover'}>
          <DiscoverTab
            settings={settings}
            aiStatus={aiStatus}
            ytdlpReady={info.ytdlp.ok}
            pushToast={pushToast}
            onSettingsChange={updateSettings}
            onPlay={playInStream}
            onOpenSettings={openAiSettings}
          />
        </TabPanel>
        <TabPanel id="stream" active={tab === 'stream'}>
          <StreamTab
            settings={settings}
            pushToast={pushToast}
            onDownload={sendToDownload}
            onQuickDownload={quickDownload}
            draft={streamDraft}
            aiReady={!!aiStatus?.ready}
            onOpenAiSettings={openAiSettings}
          />
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
            onUpdateYtdlp={installYtdlp}
            onOpenSettings={() => changeTab('settings')}
            onPlayFile={playFile}
            draft={draft}
            libState={libState}
            syncing={syncing}
            onSync={(playlist) => void syncPlaylist(playlist)}
            onSyncAll={syncAll}
          />
        </TabPanel>
        <TabPanel id="library" active={tab === 'library'}>
          <LibraryTab
            items={library}
            busy={libraryBusy}
            settings={settings}
            libState={libState}
            pushToast={pushToast}
            onRescan={() => void scanLibrary()}
            onPlay={playItems}
            onAddToPlaylist={setAddKeys}
            onSettingsChange={updateSettings}
          />
        </TabPanel>
        <TabPanel id="playlists" active={tab === 'playlists'}>
          <PlaylistsTab
            items={library}
            libState={libState}
            settings={settings}
            syncing={syncing}
            pushToast={pushToast}
            onPlay={playItems}
            onAddToPlaylist={setAddKeys}
            onSync={(playlist) => void syncPlaylist(playlist)}
            onSmartPlaylists={openSmartPlaylists}
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
            aiStatus={aiStatus}
            onAiStatus={setAiStatus}
            onBackup={backup}
          />
        </TabPanel>
      </div>

      {playQueue ? (
        <PlayerOverlay
          queue={playQueue}
          libState={libState}
          resume={settings.resumePlayback}
          onClose={closePlayer}
          onStep={stepQueue}
          onJump={(pos) => setPlayQueue((previous) => (previous ? { ...previous, pos } : previous))}
          onShuffle={(on) => setPlayQueue((previous) => (previous ? withShuffle(previous, on) : previous))}
          onRepeat={(repeat) => setPlayQueue((previous) => (previous ? { ...previous, repeat } : previous))}
          onToggleFavorite={(key) => void window.api.toggleFavorite(key)}
          onAddToPlaylist={(key) => setAddKeys([key])}
        />
      ) : null}

      {smartOpen ? (
        <SmartPlaylists
          items={library}
          pushToast={pushToast}
          onClose={() => setSmartOpen(false)}
        />
      ) : null}

      {addKeys ? <AddToPlaylist state={libState} keys={addKeys} onClose={() => setAddKeys(null)} pushToast={pushToast} /> : null}

      {paletteOpen ? (
        <CommandPalette
          commands={commands}
          linkCommands={linkCommands}
          library={library}
          onPlayItem={(item) => playItems([item], 0)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}

      {clipUrl && !playQueue ? (
        <ClipboardPrompt
          url={clipUrl}
          onWatch={() => {
            setClipUrl(null)
            playInStream(clipUrl)
          }}
          onDownload={(mode) => {
            setClipUrl(null)
            void quickDownload(clipUrl, mode)
          }}
          onOpen={() => {
            setClipUrl(null)
            openOnHome(clipUrl)
          }}
          onDismiss={dismissClip}
        />
      ) : null}

      {dragging ? (
        <div className="drop-zone">
          <div>
            <Link2 size={30} style={{ color: 'var(--accent)' }} />
            <strong>Drop the link to open it</strong>
            <span className="hint">Videos, playlists and channels</span>
          </div>
        </div>
      ) : null}

      <Toasts items={toasts} onDismiss={dismissToast} />
    </div>
  )
}
