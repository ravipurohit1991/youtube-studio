import type { ReactNode } from 'react'
import { ArrowDownToLine, Download, House, Library, ListVideo, Play, Search, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import type { AiStatus, AppInfo, TabId } from '@shared/types'
import { MOD, ProgressBar, StatusDot } from './common'

interface NavEntry {
  id: TabId
  label: string
  icon: ReactNode
  key: string
}

const SECTIONS: { title: string; entries: NavEntry[] }[] = [
  {
    title: 'Watch',
    entries: [
      { id: 'home', label: 'Home', icon: <House size={17} />, key: '1' },
      { id: 'discover', label: 'Discover', icon: <Sparkles size={17} />, key: '2' },
      { id: 'stream', label: 'Stream', icon: <Play size={17} />, key: '3' },
    ],
  },
  {
    title: 'Save',
    entries: [{ id: 'download', label: 'Download', icon: <Download size={17} />, key: '4' }],
  },
  {
    title: 'Organize',
    entries: [
      { id: 'library', label: 'Library', icon: <Library size={17} />, key: '5' },
      { id: 'playlists', label: 'Playlists', icon: <ListVideo size={17} />, key: '6' },
    ],
  },
]

/** Tab order for Ctrl+1..7. */
export const TAB_ORDER: TabId[] = ['home', 'discover', 'stream', 'download', 'library', 'playlists', 'settings']

export default function Sidebar({
  tab,
  onTab,
  info,
  activeDownloads,
  downloadFraction,
  libraryCount,
  playlistCount,
  toolBusy,
  ytdlpUpdate,
  aiStatus,
  onOpenPalette,
}: {
  tab: TabId
  onTab: (tab: TabId) => void
  info: AppInfo
  activeDownloads: number
  /** 0-1 progress of everything running or waiting, null when idle. */
  downloadFraction: number | null
  libraryCount: number
  playlistCount: number
  toolBusy: boolean
  ytdlpUpdate: boolean
  aiStatus: AiStatus | null
  onOpenPalette: () => void
}): ReactNode {
  const badge = (id: TabId): ReactNode => {
    if (id === 'download' && activeDownloads > 0) return <span className="badge chip accent">{activeDownloads}</span>
    if (id === 'library' && libraryCount > 0) return <span className="badge chip">{libraryCount}</span>
    if (id === 'playlists' && playlistCount > 0) return <span className="badge chip">{playlistCount}</span>
    if (id === 'discover' && !aiStatus?.ready) return <span className="badge chip soft">AI</span>
    return null
  }
  const item = (entry: NavEntry): ReactNode => (
    <button
      key={entry.id}
      type="button"
      className={'nav-item' + (tab === entry.id ? ' active' : '')}
      onClick={() => onTab(entry.id)}
      title={entry.label + ' (' + MOD + '+' + entry.key + ')'}
    >
      {entry.icon}
      <span>{entry.label}</span>
      {badge(entry.id)}
      <kbd>{MOD + ' ' + entry.key}</kbd>
    </button>
  )

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <ArrowDownToLine size={19} strokeWidth={2.6} />
        </div>
        <div className="brand-text">
          <strong>YTD Studio</strong>
          <span>watch · download · organize</span>
        </div>
      </div>

      <button type="button" className="search-trigger" onClick={onOpenPalette} title="Search, paste a link or run a command">
        <Search size={15} />
        <span className="grow">Search or paste a link</span>
        <kbd>{MOD} K</kbd>
      </button>

      <nav className="nav">
        {SECTIONS.map((section) => (
          <div key={section.title} style={{ display: 'contents' }}>
            <div className="nav-section">{section.title}</div>
            {section.entries.map(item)}
          </div>
        ))}
        <div className="nav-section">&nbsp;</div>
        {item({ id: 'settings', label: 'Settings', icon: <SettingsIcon size={17} />, key: '7' })}
      </nav>

      <div className="sidebar-footer">
        {activeDownloads > 0 ? (
          <button type="button" className="side-activity" onClick={() => onTab('download')}>
            <span className="row">
              <Download size={14} style={{ color: 'var(--accent)' }} />
              <span className="grow">{activeDownloads === 1 ? '1 download' : activeDownloads + ' downloads'}</span>
              <span className="stat">{downloadFraction !== null ? Math.round(downloadFraction * 100) + '%' : ''}</span>
            </span>
            <ProgressBar value={(downloadFraction ?? 0) * 100} status={downloadFraction && downloadFraction > 0.01 ? 'downloading' : 'queued'} />
          </button>
        ) : null}
        <div className="status-card">
          <button type="button" className="tool-pill" onClick={() => onTab('settings')} title={info.ytdlp.path ?? 'not installed'}>
            <StatusDot ok={info.ytdlp.ok} busy={toolBusy} />
            <span className="name">yt-dlp</span>
            <span className="value" style={{ color: ytdlpUpdate ? 'var(--warn)' : undefined }}>
              {ytdlpUpdate ? 'update ready' : info.ytdlp.version ?? 'missing'}
            </span>
          </button>
          <button type="button" className="tool-pill" onClick={() => onTab('settings')} title={info.ffmpeg.path ?? 'not found'}>
            <StatusDot ok={info.ffmpeg.ok} />
            <span className="name">ffmpeg</span>
            <span className="value">{info.ffmpeg.version ? 'ready' : 'missing'}</span>
          </button>
          <button type="button" className="tool-pill" onClick={() => onTab('settings')} title={aiStatus ? aiStatus.host : ''}>
            <StatusDot ok={!!aiStatus?.ready} />
            <span className="name">AI</span>
            <span className="value">{aiStatus?.ready ? aiStatus.model : 'not set up'}</span>
          </button>
        </div>
        <div className="version-line">
          <span>v{info.version}</span>
          <span>port {info.mediaServerPort}</span>
        </div>
      </div>
    </aside>
  )
}
