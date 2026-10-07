import type { DownloadMode, LibraryItem, ToastTone } from '@shared/types'

export type { ToastTone }

export interface DownloadDraft {
  url: string
  mode: DownloadMode
  nonce: number
}

export interface StreamDraft {
  url: string
  /** Second to start at (a key moment from an AI summary). */
  startAt?: number
  /** Stream only the audio. */
  audioOnly?: boolean
  nonce: number
}

/** A link handed to the Home tab (dropped, pasted anywhere, picked from the command palette). */
export interface LinkDraft {
  url: string
  nonce: number
}

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  actions?: ToastAction[]
}

export interface ToastOptions {
  actions?: ToastAction[]
  /** Milliseconds before it disappears; defaults depend on the tone. */
  duration?: number
}

export type PushToast = (message: string, tone?: ToastTone, options?: ToastOptions) => void

export type RepeatMode = 'off' | 'all' | 'one'

/** What the player is playing: the items, the order they play in (shuffled or not), and where it is. */
export interface PlayQueue {
  items: LibraryItem[]
  order: number[]
  pos: number
  shuffle: boolean
  repeat: RepeatMode
}
