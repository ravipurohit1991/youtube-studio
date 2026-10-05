import type { DownloadMode, LibraryItem } from '@shared/types'

export type ToastTone = 'info' | 'success' | 'error'

export interface DownloadDraft {
  url: string
  mode: DownloadMode
  nonce: number
}

export interface StreamDraft {
  url: string
  /** Second to start at (a key moment from an AI summary). */
  startAt?: number
  nonce: number
}

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

export type RepeatMode = 'off' | 'all' | 'one'

/** What the player is playing: the items, the order they play in (shuffled or not), and where it is. */
export interface PlayQueue {
  items: LibraryItem[]
  order: number[]
  pos: number
  shuffle: boolean
  repeat: RepeatMode
}
