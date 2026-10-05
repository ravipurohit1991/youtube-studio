import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TasteAction, TasteItem, TasteProfile } from '@shared/types'
import { logError } from '../logger'
import { userDataDir } from '../paths'

/**
 * Discover feedback kept across sessions (ai-taste.json): thumbs up / down on suggestions, channels
 * to never show again, and recent requests. Ranking uses it as a soft preference; blocked channels
 * are filtered out outright.
 */

const MAX_ITEMS = 200
const MAX_RECENT = 12

function empty(): TasteProfile {
  return { liked: [], disliked: [], blockedChannels: [], recent: [] }
}

function file(): string {
  return join(userDataDir(), 'ai-taste.json')
}

let data: TasteProfile | null = null

function load(): TasteProfile {
  if (data) return data
  data = empty()
  try {
    if (existsSync(file())) {
      const parsed = JSON.parse(readFileSync(file(), 'utf8')) as Partial<TasteProfile>
      data = {
        liked: Array.isArray(parsed.liked) ? parsed.liked : [],
        disliked: Array.isArray(parsed.disliked) ? parsed.disliked : [],
        blockedChannels: Array.isArray(parsed.blockedChannels) ? parsed.blockedChannels.filter((c) => typeof c === 'string') : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent.filter((r) => typeof r === 'string') : [],
      }
    }
  } catch (err) {
    logError('ai.taste.load', err)
  }
  return data
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(load(), null, 2), 'utf8')
  } catch (err) {
    logError('ai.taste.save', err)
  }
}

function clean(item: TasteItem): TasteItem {
  return { id: String(item.id), title: String(item.title ?? '').slice(0, 200), channel: item.channel ? String(item.channel).slice(0, 120) : null, at: Date.now() }
}

export function taste(): TasteProfile {
  const t = load()
  return { liked: t.liked.slice(), disliked: t.disliked.slice(), blockedChannels: t.blockedChannels.slice(), recent: t.recent.slice() }
}

export function updateTaste(action: TasteAction): TasteProfile {
  const t = load()
  if (action.kind === 'reset') {
    data = empty()
  } else if (action.kind === 'block' || action.kind === 'unblock') {
    const channel = String(action.channel ?? '').trim()
    if (channel) {
      t.blockedChannels = t.blockedChannels.filter((c) => c.toLowerCase() !== channel.toLowerCase())
      if (action.kind === 'block') t.blockedChannels.unshift(channel)
    }
  } else if ('item' in action) {
    const item = clean(action.item)
    t.liked = t.liked.filter((x) => x.id !== item.id)
    t.disliked = t.disliked.filter((x) => x.id !== item.id)
    if (action.kind === 'like') t.liked.unshift(item)
    if (action.kind === 'dislike') t.disliked.unshift(item)
    t.liked = t.liked.slice(0, MAX_ITEMS)
    t.disliked = t.disliked.slice(0, MAX_ITEMS)
  }
  save()
  return taste()
}

export function rememberRequest(prompt: string): void {
  const text = prompt.trim().slice(0, 200)
  if (!text) return
  const t = load()
  t.recent = [text, ...t.recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, MAX_RECENT)
  save()
}

export function isBlocked(channel: string | null): boolean {
  if (!channel) return false
  const lower = channel.toLowerCase()
  return load().blockedChannels.some((c) => c.toLowerCase() === lower)
}
