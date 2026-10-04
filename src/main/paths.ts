import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function userDataDir(): string {
  return app.getPath('userData')
}

export function binDir(): string {
  return join(userDataDir(), 'bin')
}

export function settingsFile(): string {
  return join(userDataDir(), 'settings.json')
}

export function jobsFile(): string {
  return join(userDataDir(), 'jobs.json')
}

export function defaultDownloadsDir(): string {
  let base = ''
  try {
    base = app.getPath('videos')
  } catch {
    base = app.getPath('home')
  }
  return join(base, 'YTD Studio')
}

export function ensureDir(dir: string): string {
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
