import type { WebContents } from 'electron'
import { log } from './logger'

let targets: WebContents[] = []

export function registerBroadcaster(get: () => WebContents[]): void {
  targets = get()
}

export function broadcast(channel: string, payload: unknown): void {
  targets.forEach(function (wc) {
    try {
      if (!wc.isDestroyed()) wc.send(channel, payload)
    } catch (err) {
      log('broadcast failed for ' + channel)
    }
  })
}
