/** Shared types used by the main process, preload bridge and renderer UI. */

export type TabId = 'home' | 'discover' | 'stream' | 'download' | 'library' | 'playlists' | 'settings'
export type DownloadMode = 'video_audio' | 'audio_only'
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac'
export type AudioQuality = '0' | '2' | '5'
export type ThemeMode = 'dark' | 'light' | 'system'
export type BrowserName = '' | 'chrome' | 'edge' | 'firefox' | 'brave' | 'opera' | 'vivaldi'
/** Accent color presets; the same names exist in the Android app. */
export type AccentName = 'crimson' | 'violet' | 'ocean' | 'emerald' | 'amber' | 'rose'
/** compatible: H.264 first (plays everywhere). best: highest quality codec (VP9/AV1 when larger). */
export type VideoCodec = 'compatible' | 'best'

export type FormatKind = 'muxed' | 'video' | 'audio'

export interface FormatInfo {
  formatId: string
  ext: string
  label: string
  kind: FormatKind
  height: number | null
  fps: number | null
  vcodec: string | null
  acodec: string | null
  abr: number | null
  tbr: number | null
  filesize: number | null
  quality: string | null
  note: string | null
  /** yt-dlp protocol: 'https' for plain files; 'm3u8_native' / 'http_dash_segments' cannot feed a <video> directly. */
  protocol: string | null
}

export interface PlaylistEntry {
  id: string
  title: string
  url: string
  duration: number | null
  thumbnail: string | null
  uploader: string | null
}

export interface VideoMeta {
  id: string
  url: string
  title: string
  uploader: string | null
  duration: number | null
  thumbnail: string | null
  description: string | null
  viewCount: number | null
  uploadDate: string | null
  isLive: boolean
  isPlaylist: boolean
  playlistTitle: string | null
  entryCount: number
  entries: PlaylistEntry[]
  formats: FormatInfo[]
  heights: number[]
  subtitles: string[]
  extractor: string | null
}

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'paused' | 'completed' | 'error' | 'canceled'

export interface DownloadJob {
  id: string
  url: string
  videoId: string | null
  title: string
  uploader: string | null
  thumbnail: string | null
  duration: number | null
  mode: DownloadMode
  qualityLabel: string
  status: JobStatus
  percent: number
  speed: string | null
  eta: string | null
  downloadedBytes: number
  totalBytes: number
  outputPath: string | null
  error: string | null
  /** Human readable step, e.g. "Downloading video stream", "Merging video and audio". */
  stage: string | null
  /** Playlist downloads: the subfolder they are saved in, and their position in the playlist. */
  folder: string | null
  playlistIndex: number | null
  logTail: string
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  /** The options it was queued with, so retry and resume (also after a restart) use the same ones. */
  request?: DownloadRequest | null
}

export interface DownloadRequest {
  url: string
  videoId?: string | null
  title?: string
  uploader?: string | null
  thumbnail?: string | null
  duration?: number | null
  mode: DownloadMode
  height?: number | null
  audioFormat?: AudioFormat
  audioQuality?: AudioQuality
  writeSubtitles?: boolean
  subtitleLanguages?: string
  writeThumbnails?: boolean
  writeMetadata?: boolean
  /** Save into this subfolder of the downloads folder (playlist downloads). */
  folder?: string | null
  /** 1-based position in the playlist; prefixes the file name so the folder keeps playlist order. */
  playlistIndex?: number | null
  /** Only download this part of the video, in seconds (null = from the start / to the end). */
  clipStart?: number | null
  clipEnd?: number | null
  /** Cut sponsor, self-promotion and "like and subscribe" segments out (SponsorBlock, needs ffmpeg). */
  sponsorBlock?: boolean
}

export type MediaKind = 'video' | 'audio'

export interface LibraryItem {
  id: string
  name: string
  relPath: string
  absPath: string
  ext: string
  kind: MediaKind
  size: number
  mtime: number
  title: string | null
  uploader: string | null
  duration: number | null
  thumbnailUrl: string | null
  mediaUrl: string
  videoId: string | null
  subtitleFiles: string[]
  isPlaylistPart: boolean
  /** Stable id for favorites, progress and playlists: the path relative to the downloads folder, with "/". */
  key: string
  /** Subfolder of the downloads folder the file is in (a downloaded playlist), or null. */
  folder: string | null
  /** Subtitle files next to it, served as WebVTT for the player. */
  subtitles: SubtitleTrack[]
}

export interface SubtitleTrack {
  /** Language code from the file name ("en", "es-419"), or "sub". */
  lang: string
  url: string
}

/** Where playback stopped. watched is set once the end was reached (or by hand). */
export interface WatchProgress {
  position: number
  duration: number
  updatedAt: number
  watched: boolean
}

/** A playlist made in the app. items are library keys, in play order. */
export interface UserPlaylist {
  id: string
  name: string
  items: string[]
  createdAt: number
}

/** A YouTube playlist kept in sync: Sync downloads only videos added since last time. */
export interface SavedPlaylist {
  id: string
  url: string
  title: string
  folder: string | null
  mode: DownloadMode
  height: number | null
  audioFormat: AudioFormat
  thumbnail: string | null
  knownIds: string[]
  lastSync: number
  lastAdded: number
}

export interface LibraryState {
  favorites: string[]
  progress: Record<string, WatchProgress>
  playlists: UserPlaylist[]
  saved: SavedPlaylist[]
}

export interface SyncResult {
  title: string
  added: number
}

export interface Settings {
  downloadsDir: string
  defaultMode: DownloadMode
  preferredHeight: number
  audioFormat: AudioFormat
  audioQuality: AudioQuality
  concurrentDownloads: number
  ytdlpPath: string
  ffmpegPath: string
  theme: ThemeMode
  writeThumbnails: boolean
  writeMetadata: boolean
  writeSubtitles: boolean
  subtitleLanguages: string
  proxy: string
  cookiesFromBrowser: BrowserName
  filenameTemplate: string
  lastTab: TabId
  /** Playlist downloads go into a subfolder named after the playlist, numbered in playlist order. */
  playlistFolders: boolean
  /** Start library items where they were left off. */
  resumePlayback: boolean
  /** Ollama server for the AI features: https://ollama.com (Ollama Cloud) or a local http://localhost:11434. */
  aiHost: string
  /** Model the AI features use, as listed by the host (for example gpt-oss:120b). */
  aiModel: string
  /** Let Discover use your library, favorites and feedback as a taste profile. */
  aiPersonalize: boolean
  /** Let Discover look the request up on the web (Ollama web search) before planning searches. */
  aiUseWeb: boolean
  /** Accent color of the interface. */
  accent: AccentName
  /** Windows notification when a download finishes while the app is in the background. */
  notifyOnComplete: boolean
  /** Offer to watch or download a YouTube link you copy, when you come back to the app. */
  watchClipboard: boolean
  /** Download speed cap for yt-dlp (--limit-rate), e.g. "2M"; empty = unlimited. */
  rateLimit: string
  /** Cut sponsor segments out of downloads by default (SponsorBlock). */
  sponsorBlock: boolean
  /** Embed cover art, chapters and tags into the downloaded file. */
  embedMetadata: boolean
  /** Sync saved playlists and channels automatically every N hours (0 = only by hand). */
  autoSyncHours: number
  /** Which video codec downloads prefer. */
  videoCodec: VideoCodec
}

export type ToastTone = 'info' | 'success' | 'error'

/** A message from the main process for the window (auto-sync results and the like). */
export interface ToastPayload {
  message: string
  tone: ToastTone
}

/** What a backup file holds. Paths and tool locations are left out: they belong to one machine. */
export interface BackupSummary {
  path: string
  favorites: number
  playlists: number
  synced: number
  progress: number
}

export interface ToolStatus {
  path: string | null
  version: string | null
  source: 'settings' | 'bundled' | 'path' | 'missing'
  ok: boolean
  hint: string | null
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  isPackaged: boolean
  mediaServerPort: number
  downloadsDir: string
  defaultDownloadsDir: string
  userDataDir: string
  ytdlp: ToolStatus
  ffmpeg: ToolStatus
  settings: Settings
}

export interface StreamTrack {
  url: string
  ext: string
  mime: string
}

export interface StreamSession {
  sessionId: string
  pageUrl: string
  videoId: string
  title: string
  uploader: string | null
  duration: number | null
  thumbnailUrl: string | null
  downloadThumbnail: string | null
  isAudioOnly: boolean
  separateAudio: boolean
  height: number | null
  heightOptions: number[]
  video: StreamTrack | null
  audio: StreamTrack | null
  formatLabel: string
}

export interface StreamRequest {
  url: string
  height?: number | null
  formatId?: string | null
  audioOnly?: boolean
}

export interface ProgressEvent {
  id: string
  status: JobStatus
  percent: number
  speed: string | null
  eta: string | null
  downloadedBytes: number
  totalBytes: number
  outputPath: string | null
  error: string | null
  title: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface UpdateStatus {
  phase: 'idle' | 'checking' | 'downloading' | 'done' | 'error'
  /** Which tool the update is about; omitted for yt-dlp. */
  tool?: 'ffmpeg'
  percent: number
  message: string
}

export interface JobProgressPayload {
  job: ProgressEvent
  full: DownloadJob
  /** The job was deleted from the list; drop it instead of upserting. */
  removed?: boolean
}

export interface ToolStatusBundle {
  ytdlp: ToolStatus
  ffmpeg: ToolStatus
}

export interface YtdlpUpdateInfo {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  error: string | null
  checkedAt: number
}

/* ---------- AI (Ollama) ---------- */

/** What the renderer may know about the AI setup. The API key itself never leaves the main process. */
export interface AiStatus {
  host: string
  model: string
  hasKey: boolean
  /** Last four characters of the key, to recognize which one is stored. */
  keyHint: string | null
  /** The key is encrypted with the OS keychain (Electron safeStorage). */
  encrypted: boolean
  /** The host is Ollama Cloud (ollama.com), which needs a key. */
  isCloud: boolean
  /** Ready to use: a model is picked and (for the cloud) a key is stored. */
  ready: boolean
}

export interface AiModel {
  name: string
  size: number | null
  parameterSize: string | null
  family: string | null
  modifiedAt: string | null
}

export interface AiTestResult {
  model: string
  reply: string
  latencyMs: number
}

export type DiscoverLength = 'any' | 'short' | 'medium' | 'long'
export type DiscoverRecency = 'any' | 'today' | 'week' | 'month' | 'year'
export type DiscoverSort = 'relevance' | 'date' | 'views' | 'rating'

export interface DiscoverRequest {
  requestId: string
  /** What to look for. Empty means "for you": derive it from the taste profile. */
  prompt: string
  /** Earlier requests in this session and follow-ups ("shorter", "less clickbait"), oldest first. */
  refinements?: string[]
  /** Video ids already shown, left out of the results ("more like this"). */
  exclude?: string[]
  length: DiscoverLength
  recency: DiscoverRecency
  avoid?: string
  personalize: boolean
  useWeb: boolean
}

export interface DiscoverQuery {
  q: string
  sort: DiscoverSort
  found: number
}

export interface DiscoverVideo {
  id: string
  url: string
  title: string
  channel: string | null
  duration: number | null
  views: number | null
  thumbnail: string | null
  /** 0-100: how well the model thinks it fits. */
  score: number | null
  /** One sentence on why it fits. */
  reason: string | null
  /** The search that found it. */
  query: string
}

export interface DiscoverResult {
  requestId: string
  /** The model's one-line reading of the request. */
  intent: string
  queries: DiscoverQuery[]
  videos: DiscoverVideo[]
  candidates: number
  webSources: { title: string; url: string }[]
  model: string
  elapsedMs: number
  /** Ranking failed and results are in search order. */
  unranked: boolean
}

export interface InsightRequest {
  requestId: string
  url: string
}

export interface AskRequest {
  requestId: string
  url: string
  question: string
  history: { role: 'user' | 'assistant'; content: string }[]
}

/** The video a summary or answer is based on. */
export interface InsightSource {
  videoId: string
  title: string
  channel: string | null
  duration: number | null
  /** Caption language used, or null when there is no transcript (description only). */
  language: string | null
  autoCaptions: boolean
}

export interface InsightResult {
  requestId: string
  source: InsightSource
  text: string
  model: string
}

export interface OrganizeGroup {
  name: string
  description: string
  keys: string[]
}

export interface OrganizeResult {
  requestId: string
  groups: OrganizeGroup[]
  considered: number
  model: string
}

/** Live progress of an AI request: a stage label, and streamed text for summaries and answers. */
export interface AiProgress {
  requestId: string
  stage?: string
  delta?: string
  thinking?: boolean
  source?: InsightSource
}

export interface TasteItem {
  id: string
  title: string
  channel: string | null
  at: number
}

/** Feedback from Discover, kept across sessions: what to steer toward and away from. */
export interface TasteProfile {
  liked: TasteItem[]
  disliked: TasteItem[]
  blockedChannels: string[]
  recent: string[]
}

export type TasteAction =
  | { kind: 'like' | 'dislike' | 'clear'; item: TasteItem }
  | { kind: 'block' | 'unblock'; channel: string }
  | { kind: 'reset' }

/** The exact surface exposed on window.api by the preload bridge. */
export interface DesktopApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>
  getSettings(): Promise<IpcResult<Settings>>
  updateSettings(patch: Partial<Settings>): Promise<IpcResult<Settings>>
  resetSettings(): Promise<IpcResult<Settings>>
  pickFolder(defaultPath?: string): Promise<IpcResult<string | null>>
  revealPath(absPath: string): Promise<IpcResult<true>>
  openPath(absPath: string): Promise<IpcResult<true>>
  readClipboard(): Promise<IpcResult<string>>
  probe(url: string): Promise<IpcResult<VideoMeta>>
  listJobs(): Promise<IpcResult<DownloadJob[]>>
  createJobs(reqs: DownloadRequest[]): Promise<IpcResult<DownloadJob[]>>
  cancelJob(id: string): Promise<IpcResult<true>>
  removeJob(id: string): Promise<IpcResult<true>>
  retryJob(id: string): Promise<IpcResult<true>>
  pauseJob(id: string): Promise<IpcResult<true>>
  resumeJob(id: string): Promise<IpcResult<true>>
  /** Move a queued job to the front of the queue. */
  prioritizeJob(id: string): Promise<IpcResult<true>>
  pauseAll(): Promise<IpcResult<number>>
  resumeAll(): Promise<IpcResult<number>>
  retryFailed(): Promise<IpcResult<number>>
  clearFinishedJobs(): Promise<IpcResult<true>>
  scanLibrary(): Promise<IpcResult<LibraryItem[]>>
  deleteLibraryItem(absPath: string): Promise<IpcResult<string[]>>
  resolveStream(req: StreamRequest): Promise<IpcResult<StreamSession>>
  releaseStream(sessionId: string): Promise<IpcResult<true>>
  getToolStatus(): Promise<IpcResult<ToolStatusBundle>>
  checkYtdlpUpdate(force?: boolean): Promise<IpcResult<YtdlpUpdateInfo>>
  updateYtdlp(): Promise<IpcResult<ToolStatus>>
  installFfmpeg(): Promise<IpcResult<ToolStatus>>
  openBinFolder(): Promise<IpcResult<true>>
  openFfmpegDownload(): Promise<IpcResult<true>>
  pickFile(defaultPath?: string): Promise<IpcResult<string | null>>
  getLibraryState(): Promise<IpcResult<LibraryState>>
  toggleFavorite(key: string): Promise<IpcResult<LibraryState>>
  saveProgress(key: string, position: number, duration: number): Promise<IpcResult<true>>
  setWatched(key: string, watched: boolean): Promise<IpcResult<LibraryState>>
  createPlaylist(name: string, items?: string[]): Promise<IpcResult<UserPlaylist>>
  renamePlaylist(id: string, name: string): Promise<IpcResult<LibraryState>>
  deletePlaylist(id: string): Promise<IpcResult<LibraryState>>
  addToPlaylist(id: string, keys: string[]): Promise<IpcResult<LibraryState>>
  removeFromPlaylist(id: string, key: string): Promise<IpcResult<LibraryState>>
  movePlaylistItem(id: string, from: number, to: number): Promise<IpcResult<LibraryState>>
  savePlaylist(playlist: SavedPlaylist): Promise<IpcResult<LibraryState>>
  removeSavedPlaylist(id: string): Promise<IpcResult<LibraryState>>
  syncPlaylist(id: string): Promise<IpcResult<SyncResult>>
  /** Save favorites, playlists, progress, synced playlists, AI taste and settings to a file. Null when canceled. */
  exportBackup(): Promise<IpcResult<BackupSummary | null>>
  /** Restore a backup file (merges into what is there). Null when canceled. */
  importBackup(): Promise<IpcResult<BackupSummary | null>>
  aiStatus(): Promise<IpcResult<AiStatus>>
  aiSetKey(key: string): Promise<IpcResult<AiStatus>>
  aiClearKey(): Promise<IpcResult<AiStatus>>
  aiListModels(): Promise<IpcResult<AiModel[]>>
  aiTest(): Promise<IpcResult<AiTestResult>>
  aiDiscover(req: DiscoverRequest): Promise<IpcResult<DiscoverResult>>
  aiSummarize(req: InsightRequest): Promise<IpcResult<InsightResult>>
  aiAsk(req: AskRequest): Promise<IpcResult<InsightResult>>
  aiOrganize(requestId: string): Promise<IpcResult<OrganizeResult>>
  aiCancel(requestId: string): Promise<IpcResult<true>>
  aiTaste(): Promise<IpcResult<TasteProfile>>
  aiTasteUpdate(action: TasteAction): Promise<IpcResult<TasteProfile>>
  onAiProgress(cb: (progress: AiProgress) => void): () => void
  onLibraryState(cb: (state: LibraryState) => void): () => void
  onJobProgress(cb: (payload: JobProgressPayload) => void): () => void
  onToolStatus(cb: (status: UpdateStatus) => void): () => void
  onToast(cb: (toast: ToastPayload) => void): () => void
}
