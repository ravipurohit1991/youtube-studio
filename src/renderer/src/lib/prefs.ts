import { useCallback, useState } from 'react'

/**
 * Small per-device UI preferences (view mode, last filters) and the stream history, kept in
 * localStorage. Everything here is optional: reads fall back to the default when storage is unavailable.
 */

export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writePref<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* preferences are best effort */
  }
}

/** useState that remembers its value across restarts. */
export function usePref<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback))
  const update = useCallback(
    (next: T) => {
      setValue(next)
      writePref(key, next)
    },
    [key],
  )
  return [value, update]
}

/** A video watched in the Stream tab, for "Recently streamed". */
export interface StreamHistoryEntry {
  url: string
  videoId: string
  title: string
  uploader: string | null
  duration: number | null
  at: number
}

const HISTORY_KEY = 'stream.history'
const HISTORY_MAX = 24

export function streamHistory(): StreamHistoryEntry[] {
  const list = readPref<StreamHistoryEntry[]>(HISTORY_KEY, [])
  return Array.isArray(list) ? list.filter((e) => e && typeof e.url === 'string') : []
}

export function rememberStream(entry: Omit<StreamHistoryEntry, 'at'>): StreamHistoryEntry[] {
  const next = [{ ...entry, at: Date.now() }, ...streamHistory().filter((e) => e.videoId !== entry.videoId)].slice(0, HISTORY_MAX)
  writePref(HISTORY_KEY, next)
  window.dispatchEvent(new Event('stream-history'))
  return next
}

export function clearStreamHistory(): void {
  writePref(HISTORY_KEY, [])
  window.dispatchEvent(new Event('stream-history'))
}
