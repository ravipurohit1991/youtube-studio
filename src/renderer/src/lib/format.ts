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

export function isYouTubeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)
}
