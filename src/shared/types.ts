/** Shared types used by the main process, preload bridge and renderer UI. */

export type TabId = 'stream' | 'download' | 'library' | 'settings'
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
  onJobProgress(cb: (payload: JobProgressPayload) => void): () => void
  onToolStatus(cb: (status: UpdateStatus) => void): () => void
}
