import { useState, type ReactNode } from 'react'
import { Cpu, Download, FolderOpen, HardDrive, Info, Network, Palette, RefreshCw, RotateCcw, Save, Wrench } from 'lucide-react'
import type { AppInfo, AudioFormat, AudioQuality, BrowserName, DownloadMode, Settings, ThemeMode, UpdateStatus, YtdlpUpdateInfo } from '@shared/types'
import { errorMessage, unwrap } from '../lib/api'
import { ProgressBar } from './common'
import type { ToastTone } from '../lib/types'

interface Props {
  info: AppInfo
  settings: Settings
  installing: boolean
  toolUpdate: UpdateStatus | null
  pushToast: (message: string, tone?: ToastTone) => void
  onSettingsChange: (patch: Partial<Settings>) => Promise<Settings | null>
  onInstallYtdlp: () => Promise<void>
  ffmpegBusy: boolean
  onInstallFfmpeg: () => Promise<void>
  onRefreshTools: () => Promise<void>
  updateInfo: YtdlpUpdateInfo | null
  onCheckUpdate: (force: boolean) => Promise<YtdlpUpdateInfo | null>
}

const BROWSERS: { value: BrowserName; label: string }[] = [
  { value: '', label: "Don't read cookies" },
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
  { value: 'opera', label: 'Opera' },
  { value: 'vivaldi', label: 'Vivaldi' },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactNode {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export default function SettingsTab({
  info,
  settings,
  installing,
  toolUpdate,
  pushToast,
  onSettingsChange,
  onInstallYtdlp,
  ffmpegBusy,
  onInstallFfmpeg,
  onRefreshTools,
  updateInfo,
  onCheckUpdate,
}: Props): ReactNode {
  const [ytdlpPathInput, setYtdlpPathInput] = useState(settings.ytdlpPath)
  const [ffmpegPathInput, setFfmpegPathInput] = useState(settings.ffmpegPath)

  const chooseFolder = async (): Promise<void> => {
    try {
      const picked = await unwrap(window.api.pickFolder(settings.downloadsDir))
      if (picked) await onSettingsChange({ downloadsDir: picked })
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const openFolder = async (target: string): Promise<void> => {
    try {
      await unwrap(window.api.openPath(target))
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  const resetAll = async (): Promise<void> => {
    try {
      await unwrap(window.api.resetSettings())
      await onSettingsChange({})
      pushToast('Settings restored to defaults.', 'success')
    } catch (err) {
      pushToast(errorMessage(err), 'error')
    }
  }

  return (
    <div className="panel-scroll">
      <div className="card">
        <div className="card-title"><HardDrive size={15} /><span>Downloads folder</span></div>
        <div className="input-row">
          <input className="input mono" value={settings.downloadsDir} readOnly />
          <button type="button" className="btn" onClick={() => void chooseFolder()}>Choose folder</button>
          <button type="button" className="btn" onClick={() => void openFolder(settings.downloadsDir)}>
            <FolderOpen size={15} />
            <span>Open</span>
          </button>
          <button type="button" className="btn ghost" onClick={() => void onSettingsChange({ downloadsDir: info.defaultDownloadsDir })}>Default</button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          New downloads go here, and the Library tab reads this folder. Thumbnails and metadata files are stored next to each video.
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Download size={15} /><span>Download defaults</span></div>
        <div className="grid-2">
          <Field label="Preferred content">
            <select className="select" value={settings.defaultMode} onChange={(event) => void onSettingsChange({ defaultMode: event.target.value as DownloadMode })}>
              <option value="video_audio">Video (with audio)</option>
              <option value="audio_only">Audio only</option>
            </select>
          </Field>
          <Field label="Preferred resolution">
            <select className="select" value={String(settings.preferredHeight)} onChange={(event) => void onSettingsChange({ preferredHeight: Number(event.target.value) })}>
              <option value="0">Best available</option>
              <option value="2160">2160p (4K)</option>
              <option value="1440">1440p</option>
              <option value="1080">1080p</option>
              <option value="720">720p</option>
              <option value="480">480p</option>
              <option value="360">360p</option>
            </select>
          </Field>
          <Field label="Audio format">
            <select className="select" value={settings.audioFormat} onChange={(event) => void onSettingsChange({ audioFormat: event.target.value as AudioFormat })}>
              <option value="mp3">MP3</option>
              <option value="m4a">M4A</option>
              <option value="opus">OPUS</option>
              <option value="wav">WAV</option>
              <option value="flac">FLAC</option>
            </select>
          </Field>
          <Field label="Audio quality">
            <select className="select" value={settings.audioQuality} onChange={(event) => void onSettingsChange({ audioQuality: event.target.value as AudioQuality })}>
              <option value="0">Best (VBR 0)</option>
              <option value="2">Good (VBR 2)</option>
              <option value="5">Small (VBR 5)</option>
            </select>
          </Field>
          <Field label="Simultaneous downloads" hint="Higher is faster but heavier on your connection.">
            <select className="select" value={String(settings.concurrentDownloads)} onChange={(event) => void onSettingsChange({ concurrentDownloads: Number(event.target.value) })}>
              <option value="1">1 at a time</option>
              <option value="2">2 at a time</option>
              <option value="3">3 at a time</option>
              <option value="4">4 at a time</option>
            </select>
          </Field>
        </div>

        <div className="divider" />

        <div className="row">
          <label className="check">
            <input type="checkbox" checked={settings.writeThumbnails} onChange={(event) => void onSettingsChange({ writeThumbnails: event.target.checked })} />
            <span>Save thumbnail images</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.writeMetadata} onChange={(event) => void onSettingsChange({ writeMetadata: event.target.checked })} />
            <span>Save metadata files</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.writeSubtitles} onChange={(event) => void onSettingsChange({ writeSubtitles: event.target.checked })} />
            <span>Download subtitles</span>
          </label>
          <input
            className="input"
            style={{ width: 190 }}
            value={settings.subtitleLanguages}
            spellCheck={false}
            placeholder="en,es"
            onChange={(event) => void onSettingsChange({ subtitleLanguages: event.target.value })}
          />
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          Metadata files are what let the Library show real titles, durations and thumbnails. Subtitles use the languages above, comma separated.
        </div>

        <div className="divider" />

        <Field label="Filename template" hint="yt-dlp template. %(title)s and %(id)s keep names readable and unique.">
          <input
            className="input mono"
            value={settings.filenameTemplate}
            spellCheck={false}
            onChange={(event) => void onSettingsChange({ filenameTemplate: event.target.value })}
          />
        </Field>
      </div>

      <div className="card">
        <div className="card-title"><Wrench size={15} /><span>Tools</span></div>

        <div className="kv">
          <dt>yt-dlp</dt>
          <dd>
            <span className={'chip ' + (info.ytdlp.ok ? 'ok' : 'err')}>{info.ytdlp.ok ? 'ready' : 'missing'}</span>{' '}
            <span className="mono">{info.ytdlp.version ?? 'not installed'}</span>
            {info.ytdlp.path ? <div className="hint mono">{info.ytdlp.path}</div> : null}
          </dd>
          <dt>ffmpeg</dt>
          <dd>
            <span className={'chip ' + (info.ffmpeg.ok ? 'ok' : 'warn')}>{info.ffmpeg.ok ? 'ready' : 'missing'}</span>{' '}
            <span className="mono">{info.ffmpeg.version ?? 'not found'}</span>
            {info.ffmpeg.path ? <div className="hint mono">{info.ffmpeg.path}</div> : null}
            {info.ffmpeg.hint ? <div className="hint wrap-anywhere">{info.ffmpeg.hint}</div> : null}
            {!info.ffmpeg.ok ? (
              <div className="row tight" style={{ marginTop: 8 }}>
                <button type="button" className="btn small primary" disabled={ffmpegBusy} onClick={() => void onInstallFfmpeg()}>
                  <Download size={14} />
                  <span>{ffmpegBusy ? 'Installing...' : 'Install ffmpeg'}</span>
                </button>
                <button type="button" className="btn small ghost" onClick={() => void window.api.openFfmpegDownload()}>
                  <span>Download manually</span>
                </button>
                <button type="button" className="btn small" onClick={() => void onRefreshTools()}>
                  <RefreshCw size={14} />
                  <span>Recheck</span>
                </button>
              </div>
            ) : null}
          </dd>
        </div>

        {toolUpdate ? (
          <div style={{ marginTop: 14 }}>
            <div className="hint" style={{ marginBottom: 6 }}>{toolUpdate.message}</div>
            <ProgressBar value={toolUpdate.percent} status={toolUpdate.phase === 'error' ? 'error' : toolUpdate.phase === 'done' ? 'completed' : 'downloading'} />
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn primary" disabled={installing} onClick={() => void onInstallYtdlp()}>
            <Download size={15} />
            <span>
              {installing
                ? 'Updating...'
                : updateInfo && updateInfo.updateAvailable
                  ? 'Update to ' + updateInfo.latest
                  : info.ytdlp.ok
                    ? 'Reinstall latest yt-dlp'
                    : 'Install yt-dlp'}
            </span>
          </button>
          <button type="button" className="btn" disabled={installing} onClick={() => void onCheckUpdate(true)}>
            <RefreshCw size={15} />
            <span>Check for updates</span>
          </button>
          <button type="button" className="btn" onClick={() => void onRefreshTools()}>Recheck</button>
          <button type="button" className="btn ghost" onClick={() => void window.api.openBinFolder()}>Open tools folder</button>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>
          {updateInfo
            ? updateInfo.error
              ? 'Update check failed: ' + updateInfo.error
              : updateInfo.updateAvailable
                ? 'A newer yt-dlp (' + updateInfo.latest + ') is available. You have ' + (updateInfo.current ?? 'nothing installed') + '. Keeping yt-dlp current is what keeps downloads working when YouTube changes.'
                : info.ytdlp.ok
                  ? 'yt-dlp is up to date (' + (updateInfo.latest ?? updateInfo.current ?? '') + ').'
                  : 'yt-dlp is not installed yet.'
            : 'yt-dlp is what talks to YouTube. Check here any time downloads start failing.'}
        </div>

        <div className="divider" />

        <div className="grid-2">
          <Field label="Custom yt-dlp path" hint="Leave empty to use the managed copy or PATH.">
            <div className="input-row">
              <input className="input mono" value={ytdlpPathInput} spellCheck={false} placeholder="C:\\tools\\yt-dlp.exe" onChange={(event) => setYtdlpPathInput(event.target.value)} />
              <button type="button" className="btn" onClick={() => void onSettingsChange({ ytdlpPath: ytdlpPathInput.trim() })}>
                <Save size={15} />
              </button>
            </div>
          </Field>
          <Field label="Custom ffmpeg path" hint="Only needed if ffmpeg is installed somewhere the app cannot find on its own.">
            <div className="input-row">
              <input className="input mono" value={ffmpegPathInput} spellCheck={false} placeholder="C:\\ffmpeg\\bin\\ffmpeg.exe" onChange={(event) => setFfmpegPathInput(event.target.value)} />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void (async () => {
                    const picked = await window.api.pickFile(ffmpegPathInput || undefined)
                    if (picked.ok && picked.data) {
                      setFfmpegPathInput(picked.data)
                      void onSettingsChange({ ffmpegPath: picked.data })
                    }
                  })()
                }}
              >
                <FolderOpen size={15} />
                <span>Browse</span>
              </button>
              <button type="button" className="btn" onClick={() => void onSettingsChange({ ffmpegPath: ffmpegPathInput.trim() })}>
                <Save size={15} />
              </button>
            </div>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Network size={15} /><span>Network and access</span></div>
        <div className="grid-2">
          <Field label="Proxy" hint="Optional, for example socks5://127.0.0.1:1080">
            <input className="input mono" value={settings.proxy} spellCheck={false} placeholder="none" onChange={(event) => void onSettingsChange({ proxy: event.target.value })} />
          </Field>
          <Field label="Browser cookies" hint="Useful for age-restricted or private videos.">
            <select className="select" value={settings.cookiesFromBrowser} onChange={(event) => void onSettingsChange({ cookiesFromBrowser: event.target.value as BrowserName })}>
              {BROWSERS.map((browser) => (
                <option key={browser.value} value={browser.value}>{browser.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Palette size={15} /><span>Appearance</span></div>
        <div className="segmented">
          {(['dark', 'light', 'system'] as ThemeMode[]).map((theme) => (
            <button key={theme} type="button" className={settings.theme === theme ? 'active' : ''} onClick={() => void onSettingsChange({ theme })}>
              {theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Match system'}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title"><Info size={15} /><span>About</span></div>
        <dl className="kv">
          <dt>YTD Studio</dt>
          <dd>v{info.version}</dd>
          <dt>Electron / Chromium</dt>
          <dd className="mono">{info.electron} / {info.chrome}</dd>
          <dt>Node</dt>
          <dd className="mono">{info.node}</dd>
          <dt>Platform</dt>
          <dd className="mono">{info.platform}</dd>
          <dt>Local media server</dt>
          <dd className="mono">http://127.0.0.1:{info.mediaServerPort}</dd>
          <dt>App data</dt>
          <dd className="mono wrap-anywhere">{info.userDataDir}</dd>
        </dl>
        <div className="row" style={{ marginTop: 16 }}>
          <button type="button" className="btn" onClick={() => void openFolder(info.userDataDir)}>
            <FolderOpen size={15} />
            <span>Open app data folder</span>
          </button>
          <button type="button" className="btn danger" onClick={() => void resetAll()}>
            <RotateCcw size={15} />
            <span>Reset all settings</span>
          </button>
          <span className="stat"><Cpu size={13} /> Streams are proxied locally, so playback and seeking behave like a normal file.</span>
        </div>
      </div>
    </div>
  )
}
