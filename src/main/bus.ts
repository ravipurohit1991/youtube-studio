import type { WebContents } from 'electron'
import { log } from './logger'

let getTargets: () => WebContents[] = function () { return [] }

/**
 * Register how to find the windows to notify. The getter is called on every broadcast: the
 * window is created after this is registered (and can be re-created), so a snapshot taken here
 * would be empty and every job/progress event would silently go nowhere.
 */
export function registerBroadcaster(get: () => WebContents[]): void {
  getTargets = get
}

export function broadcast(channel: string, payload: unknown): void {
  getTargets().forEach(function (wc) {
    try {
      if (!wc.isDestroyed()) wc.send(channel, payload)
    } catch (err) {
      log('broadcast failed for ' + channel)
    }
  })
}
