/** Shared types used by the main process, preload bridge and renderer UI. */

export type TabId = 'stream' | 'download' | 'library' | 'playlists' | 'settings'
export type DownloadMode = 'video_audio' | 'audio_only'
export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac'
export type AudioQuality = '0' | '2' | '5'
export type ThemeMode = 'dark' | 'light' | 'system'
export type BrowserName = '' | 'chrome' | 'edge' | 'firefox' | 'brave' | 'opera' | 'vivaldi'

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

export type JobStatus = 'queued' | 'downloading' | 'processing' | 'completed' | 'error' | 'canceled'

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
  onLibraryState(cb: (state: LibraryState) => void): () => void
  onJobProgress(cb: (payload: JobProgressPayload) => void): () => void
  onToolStatus(cb: (status: UpdateStatus) => void): () => void
}
