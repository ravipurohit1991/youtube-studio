import type { ReactNode } from 'react'
import { Download, FolderCheck, Library, Play, Settings as SettingsIcon } from 'lucide-react'
import type { AppInfo, TabId } from '@shared/types'
import { StatusDot } from './common'

const NAV: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'stream', label: 'Stream', icon: <Play size={17} /> },
  { id: 'download', label: 'Download', icon: <Download size={17} /> },
  { id: 'library', label: 'Library', icon: <Library size={17} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} /> },
]

export default function Sidebar({
  tab,
  onTab,
  info,
  activeDownloads,
  libraryCount,
  toolBusy,
  ytdlpUpdate,
}: {
  tab: TabId
  onTab: (tab: TabId) => void
  info: AppInfo
  activeDownloads: number
  libraryCount: number
  toolBusy: boolean
  ytdlpUpdate: boolean
}): ReactNode {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Play size={18} fill="currentColor" />
        </div>
        <div className="brand-text">
          <strong>YTD Studio</strong>
          <span>stream · download · library</span>
        </div>
      </div>

      <nav className="nav">
        {NAV.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={'nav-item' + (tab === entry.id ? ' active' : '')}
            onClick={() => onTab(entry.id)}
          >
            {entry.icon}
            <span>{entry.label}</span>
            {entry.id === 'download' && activeDownloads > 0 ? (
              <span className="badge chip accent">{activeDownloads}</span>
            ) : null}
            {entry.id === 'library' && libraryCount > 0 ? (
              <span className="badge chip">{libraryCount}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="tool-pill" onClick={() => onTab('settings')} title={info.ytdlp.path ?? 'not installed'}>
          <StatusDot ok={info.ytdlp.ok} busy={toolBusy} />
          <span className="name">yt-dlp</span>
          <span style={{ marginLeft: 'auto', color: ytdlpUpdate ? 'var(--warn)' : undefined }}>
            {ytdlpUpdate ? 'update ready' : info.ytdlp.version ?? 'missing'}
          </span>
        </button>
        <button type="button" className="tool-pill" onClick={() => onTab('settings')} title={info.ffmpeg.path ?? 'not found'}>
          <StatusDot ok={info.ffmpeg.ok} />
          <span className="name">ffmpeg</span>
          <span style={{ marginLeft: 'auto' }}>{info.ffmpeg.version ? 'ok' : 'missing'}</span>
        </button>
        <button type="button" className="tool-pill" onClick={() => onTab('library')}>
          <FolderCheck size={14} style={{ color: 'var(--text-faint)' }} />
          <span>v{info.version}</span>
          <span style={{ marginLeft: 'auto' }}>port {info.mediaServerPort}</span>
        </button>
      </div>
    </aside>
  )
}
