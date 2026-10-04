import type { DownloadMode } from '@shared/types'

export type ToastTone = 'info' | 'success' | 'error'

export interface DownloadDraft {
  url: string
  mode: DownloadMode
  nonce: number
}

export interface ToastItem {
  id: number
  message: string
  tone: ToastTone
}

export interface PlayerModel {
  title: string
  subtitle: string | null
  kind: 'video' | 'audio'
  videoUrl: string | null
  audioUrl: string | null
  separateAudio: boolean
  absPath: string | null
  sessionId: string | null
  duration: number | null
}
