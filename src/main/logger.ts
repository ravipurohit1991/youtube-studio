import { app } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

let logFile = ''
let ready = false

function safe(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Point the logger at the per-user log file. Safe to call more than once. */
export function initLogger(): void {
  try {
    logFile = join(app.getPath('userData'), 'app.log')
    ready = true
  } catch {
    ready = false
  }
}

export function log(...parts: unknown[]): void {
  const line = '[' + new Date().toISOString() + '] ' + parts.map(safe).join(' ')
  // eslint-disable-next-line no-console
  console.log(line)
  if (!ready || !logFile) return
  try {
    appendFileSync(logFile, line + '\n')
  } catch {
    /* logging must never throw */
  }
}

export function logError(scope: string, err: unknown): void {
  if (err instanceof Error) log('ERROR', scope, err.message, '\n' + (err.stack ?? ''))
  else log('ERROR', scope, safe(err))
}
