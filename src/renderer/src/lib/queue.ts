import type { LibraryItem } from '@shared/types'
import type { PlayQueue, RepeatMode } from './types'

function shuffled(values: number[]): number[] {
  const out = values.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const swap = out[i]
    out[i] = out[j]
    out[j] = swap
  }
  return out
}

/** Order of play: the current item first, the rest shuffled, or everything in list order. */
function orderFor(count: number, current: number, shuffle: boolean): { order: number[]; pos: number } {
  const all = Array.from({ length: count }, (_, i) => i)
  if (!shuffle) return { order: all, pos: current }
  return { order: [current, ...shuffled(all.filter((i) => i !== current))], pos: 0 }
}

export function makeQueue(items: LibraryItem[], start: number, shuffle = false, repeat: RepeatMode = 'off'): PlayQueue {
  const first = shuffle && start < 0 ? Math.floor(Math.random() * items.length) : Math.max(0, Math.min(start, items.length - 1))
  return { items, ...orderFor(items.length, first, shuffle), shuffle, repeat }
}

export function currentItem(queue: PlayQueue): LibraryItem | null {
  return queue.items[queue.order[queue.pos]] ?? null
}

export function withShuffle(queue: PlayQueue, shuffle: boolean): PlayQueue {
  const current = queue.order[queue.pos] ?? 0
  return { ...queue, ...orderFor(queue.items.length, current, shuffle), shuffle }
}

/** The queue moved by delta, or null when it runs off the end (with repeat-all it wraps). */
export function stepped(queue: PlayQueue, delta: number): PlayQueue | null {
  const next = queue.pos + delta
  if (next >= 0 && next < queue.order.length) return { ...queue, pos: next }
  if (queue.repeat !== 'all' || !queue.order.length) return null
  return { ...queue, pos: (next + queue.order.length) % queue.order.length }
}

export function hasStep(queue: PlayQueue, delta: number): boolean {
  return stepped(queue, delta) !== null
}
