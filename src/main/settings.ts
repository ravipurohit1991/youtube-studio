import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { AccentName, Settings, TabId } from '@shared/types'
import { log, logError } from './logger'
import { defaultDownloadsDir, ensureDir, settingsFile } from './paths'

export const DEFAULT_AI_HOST = 'https://ollama.com'

function defaults(): Settings {
  return {
    downloadsDir: defaultDownloadsDir(),
    defaultMode: 'video_audio',
    preferredHeight: 1080,
    audioFormat: 'mp3',
    audioQuality: '0',
    concurrentDownloads: 2,
    ytdlpPath: '',
    ffmpegPath: '',
    theme: 'dark',
    writeThumbnails: true,
    writeMetadata: true,
    writeSubtitles: false,
    subtitleLanguages: 'en',
    proxy: '',
    cookiesFromBrowser: '',
    filenameTemplate: '%(title)s [%(id)s].%(ext)s',
    lastTab: 'home',
    playlistFolders: true,
    resumePlayback: true,
    aiHost: DEFAULT_AI_HOST,
    aiModel: '',
    aiPersonalize: true,
    aiUseWeb: false,
    accent: 'crimson',
    notifyOnComplete: true,
    watchClipboard: true,
    rateLimit: '',
    sponsorBlock: false,
    embedMetadata: true,
    autoSyncHours: 0,
    videoCodec: 'compatible',
  }
}

const VALID_TABS: TabId[] = ['home', 'discover', 'stream', 'download', 'library', 'playlists', 'settings']
const ACCENTS: AccentName[] = ['crimson', 'violet', 'ocean', 'emerald', 'amber', 'rose']
const SYNC_HOURS = [0, 1, 3, 6, 12, 24]

function coerce(raw: Partial<Settings>): Settings {
  const base = defaults()
  const merged: Settings = { ...base, ...raw }
  if (!merged.downloadsDir) merged.downloadsDir = base.downloadsDir
  if (!merged.filenameTemplate) merged.filenameTemplate = base.filenameTemplate
  if (typeof merged.concurrentDownloads !== 'number' || merged.concurrentDownloads < 1) merged.concurrentDownloads = 1
  if (merged.concurrentDownloads > 4) merged.concurrentDownloads = 4
  if (merged.defaultMode !== 'video_audio' && merged.defaultMode !== 'audio_only') merged.defaultMode = 'video_audio'
  if (!VALID_TABS.includes(merged.lastTab)) merged.lastTab = 'home'
  if (typeof merged.preferredHeight !== 'number' || merged.preferredHeight < 0) merged.preferredHeight = 1080
  merged.aiHost = typeof merged.aiHost === 'string' && merged.aiHost.trim() ? merged.aiHost.trim().replace(/\/+$/, '') : base.aiHost
  if (typeof merged.aiModel !== 'string') merged.aiModel = ''
  if (!ACCENTS.includes(merged.accent)) merged.accent = base.accent
  if (!SYNC_HOURS.includes(merged.autoSyncHours)) merged.autoSyncHours = 0
  if (merged.videoCodec !== 'compatible' && merged.videoCodec !== 'best') merged.videoCodec = 'compatible'
  // yt-dlp rate syntax: a number with an optional K/M/G suffix.
  merged.rateLimit = typeof merged.rateLimit === 'string' && /^\d+(\.\d+)?[KMG]?$/i.test(merged.rateLimit.trim()) ? merged.rateLimit.trim().toUpperCase() : ''
  return merged
}

class SettingsStore {
  private data: Settings = defaults()

  load(): Settings {
    try {
      const file = settingsFile()
      if (existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Settings>
        this.data = coerce(parsed)
      }
    } catch (err) {
      logError('settings.load', err)
    }
    ensureDir(this.data.downloadsDir)
    return this.data
  }

  all(): Settings {
    return { ...this.data }
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key]
  }

  update(patch: Partial<Settings>): Settings {
    this.data = coerce({ ...this.data, ...patch })
    ensureDir(this.data.downloadsDir)
    this.save()
    return this.all()
  }

  reset(): Settings {
    this.data = defaults()
    ensureDir(this.data.downloadsDir)
    this.save()
    return this.all()
  }

  private save(): void {
    try {
      writeFileSync(settingsFile(), JSON.stringify(this.data, null, 2), 'utf8')
    } catch (err) {
      logError('settings.save', err)
    }
  }
}

export const settings = new SettingsStore()
export { defaults as defaultSettings }

/** Log-safe summary of the current configuration. */
export function describeSettings(): string {
  const s = settings.all()
  return 'downloads=' + s.downloadsDir + ' mode=' + s.defaultMode + ' concurrency=' + s.concurrentDownloads
}
