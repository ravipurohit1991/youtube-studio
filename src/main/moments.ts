import { BrowserWindow, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Moment, MomentInput } from '@shared/types'
import { IPC } from '@shared/ipc'
import { broadcast } from './bus'
import { logError } from './logger'
import { userDataDir } from './paths'

/**
 * Moments: bookmarks inside videos, with an optional note ("the part about indexes", "chorus starts").
 * They belong to a library item, a streamed YouTube video, or both, and open right at that second.
 */

const MAX_MOMENTS = 5000
let list: Moment[] | null = null
let saveTimer: NodeJS.Timeout | null = null

function file(): string {
  return join(userDataDir(), 'moments.json')
}

function clean(raw: Partial<Moment>): Moment | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.at !== 'number' || !isFinite(raw.at)) return null
  return {
    id: raw.id,
    key: typeof raw.key === 'string' && raw.key ? raw.key : null,
    videoId: typeof raw.videoId === 'string' && raw.videoId ? raw.videoId : null,
    url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? raw.url : null,
    title: String(raw.title ?? 'Untitled').slice(0, 300),
    channel: typeof raw.channel === 'string' ? raw.channel.slice(0, 200) : null,
    at: Math.max(0, raw.at),
    note: String(raw.note ?? '').slice(0, 2000),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  }
}

function data(): Moment[] {
  if (list) return list
  list = []
  try {
    if (existsSync(file())) {
      const raw = JSON.parse(readFileSync(file(), 'utf8')) as unknown
      if (Array.isArray(raw)) list = raw.map((m) => clean(m as Partial<Moment>)).filter((m): m is Moment => !!m)
    }
  } catch (err) {
    logError('moments.load', err)
  }
  return list
}

function commit(next: Moment[]): Moment[] {
  list = next.slice(-MAX_MOMENTS)
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null
      flushMoments()
    }, 400)
  }
  broadcast(IPC.momentsChanged, list)
  return list
}

export function flushMoments(): void {
  if (!list) return
  try {
    writeFileSync(file() + '.tmp', JSON.stringify(list), 'utf8')
    renameSync(file() + '.tmp', file())
  } catch (err) {
    logError('moments.save', err)
  }
}

export function moments(): Moment[] {
  return data()
}

export function addMoment(input: MomentInput): Moment {
  const moment = clean({ ...input, id: randomUUID(), createdAt: Date.now() })
  if (!moment) throw new Error('That moment has no time.')
  if (!moment.key && !moment.url) throw new Error('A moment needs a library item or a YouTube link.')
  commit([...data(), moment])
  return moment
}

export function updateMoment(id: string, note: string): Moment[] {
  return commit(data().map((m) => (m.id === id ? { ...m, note: String(note ?? '').slice(0, 2000) } : m)))
}

export function removeMoment(id: string): Moment[] {
  return commit(data().filter((m) => m.id !== id))
}

/** Backups: moments are added by id, up to the limit; nothing already here is lost or pushed out. */
export function mergeMoments(incoming: unknown): number {
  if (!Array.isArray(incoming)) return 0
  const current = data()
  const known = new Set(current.map((m) => m.id))
  const room = Math.max(0, MAX_MOMENTS - current.length)
  const added: Moment[] = []
  for (const raw of incoming) {
    if (added.length >= room) break
    const moment = clean(raw as Partial<Moment>)
    if (!moment || known.has(moment.id)) continue
    known.add(moment.id)
    added.push(moment)
  }
  if (added.length) commit([...current, ...added])
  return added.length
}

function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => (n < 10 ? '0' + n : String(n))
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

/** Moments as Markdown: one section per video, timestamps linking to that second on YouTube. */
export function momentsMarkdown(items: Moment[]): string {
  const groups = new Map<string, Moment[]>()
  items.forEach((m) => {
    const id = m.videoId ?? m.key ?? m.url ?? m.title
    groups.set(id, [...(groups.get(id) ?? []), m])
  })
  const lines = ['# Moments', '', '_Exported from YTD Studio on ' + new Date().toLocaleDateString() + '._', '']
  groups.forEach((group) => {
    const first = group[0]
    lines.push('## ' + first.title + (first.channel ? ' — ' + first.channel : ''), '')
    group
      .slice()
      .sort((a, b) => a.at - b.at)
      .forEach((m) => {
        const link = m.videoId ? 'https://www.youtube.com/watch?v=' + m.videoId + '&t=' + Math.floor(m.at) + 's' : null
        const stamp = link ? '[' + clock(m.at) + '](' + link + ')' : '`' + clock(m.at) + '`'
        lines.push('- ' + stamp + (m.note.trim() ? ' ' + m.note.trim().replace(/\s*\n\s*/g, ' ') : ''))
      })
    lines.push('')
  })
  return lines.join('\n')
}

export async function exportMoments(filter?: { key?: string | null; videoId?: string | null }): Promise<string | null> {
  const chosen = data().filter((m) => {
    if (!filter || (!filter.key && !filter.videoId)) return true
    return (!!filter.key && m.key === filter.key) || (!!filter.videoId && m.videoId === filter.videoId)
  })
  if (!chosen.length) throw new Error('There are no moments to export yet.')
  const window = BrowserWindow.getFocusedWindow()
  const name = chosen.length && filter && (filter.key || filter.videoId) ? chosen[0].title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 60) + ' - moments.md' : 'moments.md'
  const options = { title: 'Export moments', defaultPath: name, filters: [{ name: 'Markdown', extensions: ['md'] }] }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  writeFileSync(result.filePath, momentsMarkdown(chosen), 'utf8')
  return result.filePath
}
