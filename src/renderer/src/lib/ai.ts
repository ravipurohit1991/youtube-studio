import { useEffect, useState } from 'react'
import type { InsightSource } from '@shared/types'

export function newRequestId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

export interface AiLive {
  stage: string | null
  /** Streamed answer text so far. */
  text: string
  thinking: boolean
  source: InsightSource | null
}

const IDLE: AiLive = { stage: null, text: '', thinking: false, source: null }

/** Live progress (stage, streamed text) of the AI request with this id; resets when the id changes. */
export function useAiLive(requestId: string | null): AiLive {
  const [live, setLive] = useState<AiLive>(IDLE)
  useEffect(() => {
    setLive(IDLE)
    if (!requestId) return undefined
    return window.api.onAiProgress((progress) => {
      if (progress.requestId !== requestId) return
      setLive((prev) => ({
        stage: progress.stage ?? prev.stage,
        text: progress.delta ? prev.text + progress.delta : prev.text,
        thinking: progress.delta ? false : progress.thinking ?? prev.thinking,
        source: progress.source ?? prev.source,
      }))
    })
  }, [requestId])
  return live
}

/** "[1:02:03]" / "[02:03]" to seconds. */
export function parseStamp(stamp: string): number {
  return stamp
    .replace(/[[\]]/g, '')
    .split(':')
    .map(Number)
    .reduce((sum, n) => sum * 60 + (isNaN(n) ? 0 : n), 0)
}
