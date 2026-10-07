export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return (value >= 10 || unit === 0 ? Math.round(value).toString() : value.toFixed(1)) + ' ' + units[unit]
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !isFinite(seconds) || seconds <= 0) return '--:--'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

/** "12 h 40 min", "35 min": total play time in words. */
export function formatHours(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0 min'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes + ' min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h + ' h' + (m ? ' ' + m + ' min' : '')
}

/** "1:23", "83", "1:02:03" or "1h2m3s" to seconds; null when empty or not a time. */
export function parseTime(value: string): number | null {
  const text = value.trim().toLowerCase()
  if (!text) return null
  const units = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/.exec(text)
  if (units && (units[1] || units[2] || units[3])) {
    return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)
  }
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null
  return text.split(':').map(Number).reduce((sum, n) => sum * 60 + n, 0)
}

export function formatCount(count: number | null | undefined): string {
  if (count === null || count === undefined || !isFinite(count)) return ''
  if (count >= 1_000_000_000) return (count / 1_000_000_000).toFixed(1) + 'B'
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M'
  if (count >= 1_000) return (count / 1_000).toFixed(1) + 'K'
  return String(count)
}

export function timeAgo(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes + 'm ago'
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours + 'h ago'
  const days = Math.floor(hours / 24)
  if (days < 30) return days + 'd ago'
  const months = Math.floor(days / 30)
  if (months < 12) return months + 'mo ago'
  return Math.floor(months / 12) + 'y ago'
}

export function humanDate(ms: number): string {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return ''
  }
}

/** "Good morning" etc. for the Home greeting. */
export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function isYouTubeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(trimmed)
}

/** The first YouTube link in a piece of text (a pasted message, a dropped URL list). */
export function findYouTubeUrl(text: string | null | undefined): string | null {
  if (!text) return null
  const match = /(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\/[^\s"'<>]+/i.exec(text)
  if (!match) return null
  const url = match[0].replace(/[).,;]+$/, '')
  return /^https?:\/\//i.test(url) ? url : 'https://' + url
}

/** The 11-character video id of a watch / youtu.be / shorts link. */
export function youTubeId(url: string): string | null {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\.|^m\.|^music\./, '')
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] ?? null
    const v = parsed.searchParams.get('v')
    if (v) return v
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts.length >= 2 && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) return parts[1]
  } catch {
    /* not a URL */
  }
  return null
}

/** Playlists and channels hold many videos; everything else is one. */
export function looksLikeCollection(url: string): boolean {
  return /[?&]list=|\/playlist\b|\/@|\/channel\/|\/c\/|\/user\//i.test(url) && !/[?&]v=/.test(url)
}

export function ytThumb(id: string | null | undefined): string | null {
  return id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : null
}
