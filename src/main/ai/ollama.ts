import { safeStorage } from 'electron'
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AiModel, AiStatus } from '@shared/types'
import { log, logError } from '../logger'
import { userDataDir } from '../paths'
import { DEFAULT_AI_HOST, settings } from '../settings'

/**
 * Ollama client for the AI features. Ollama Cloud (https://ollama.com) and a local Ollama
 * (http://localhost:11434) speak the same API; the cloud one needs "Authorization: Bearer <key>".
 * The key lives only in the main process: it is stored encrypted with the OS keychain when
 * possible (Electron safeStorage) and the renderer only ever sees whether one is set.
 */

const WEB_SEARCH_URL = 'https://ollama.com/api/web_search'
/** Give up when the server sends nothing for this long (big cloud models can think for a while). */
const IDLE_TIMEOUT = 150000
const TOTAL_TIMEOUT = 8 * 60 * 1000

// ---------- API key ----------

interface StoredKey {
  v: 1
  enc: 'safe' | 'plain'
  data: string
}

let cachedKey: string | null | undefined

function keyFile(): string {
  return join(userDataDir(), 'ai-key.json')
}

function readStored(): StoredKey | null {
  try {
    if (!existsSync(keyFile())) return null
    const parsed = JSON.parse(readFileSync(keyFile(), 'utf8')) as StoredKey
    return parsed && typeof parsed.data === 'string' ? parsed : null
  } catch (err) {
    logError('ai.key.read', err)
    return null
  }
}

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** The stored key, else OLLAMA_API_KEY from the environment, else null. */
export function apiKey(): string | null {
  if (cachedKey !== undefined) return cachedKey
  const stored = readStored()
  let key: string | null = null
  if (stored) {
    try {
      key = stored.enc === 'safe' ? safeStorage.decryptString(Buffer.from(stored.data, 'base64')) : Buffer.from(stored.data, 'base64').toString('utf8')
    } catch (err) {
      logError('ai.key.decrypt', err)
      key = null
    }
  }
  if (!key) key = (process.env.OLLAMA_API_KEY ?? '').trim() || null
  cachedKey = key
  return key
}

export function saveApiKey(raw: string): void {
  const key = raw.trim().replace(/^Bearer\s+/i, '')
  if (!key) throw new Error('Paste your Ollama API key first.')
  if (/\s/.test(key)) throw new Error('That does not look like an API key (it contains spaces).')
  const encrypted = canEncrypt()
  const stored: StoredKey = {
    v: 1,
    enc: encrypted ? 'safe' : 'plain',
    data: encrypted ? safeStorage.encryptString(key).toString('base64') : Buffer.from(key, 'utf8').toString('base64'),
  }
  writeFileSync(keyFile(), JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(keyFile(), 0o600)
  } catch {
    /* best effort on Windows */
  }
  cachedKey = key
  log('ai: API key saved', encrypted ? '(encrypted)' : '(OS encryption unavailable, stored obfuscated)')
}

export function clearApiKey(): void {
  try {
    if (existsSync(keyFile())) unlinkSync(keyFile())
  } catch (err) {
    logError('ai.key.clear', err)
  }
  cachedKey = undefined
}

export function aiHost(): string {
  return (settings.get('aiHost') || DEFAULT_AI_HOST).replace(/\/+$/, '')
}

export function isCloudHost(host = aiHost()): boolean {
  try {
    const name = new URL(host).hostname
    return name === 'ollama.com' || name.endsWith('.ollama.com')
  } catch {
    return false
  }
}

/**
 * Where the key may go: Ollama Cloud, any HTTPS server (e.g. a self-hosted Ollama behind a proxy), or
 * this machine. Never over plain HTTP to another machine, where it would cross the network in clear text
 * (a LAN Ollama does not need a key anyway).
 */
export function keyAllowedFor(host: string): boolean {
  try {
    const url = new URL(host)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function aiStatus(): AiStatus {
  const key = apiKey()
  const stored = readStored()
  const host = aiHost()
  const cloud = isCloudHost(host)
  const model = settings.get('aiModel')
  return {
    host,
    model,
    hasKey: !!key,
    keyHint: key ? key.slice(-4) : null,
    encrypted: !!stored && stored.enc === 'safe',
    isCloud: cloud,
    ready: !!model && (!cloud || !!key),
  }
}

// ---------- requests (cancellable) ----------

const running = new Map<string, AbortController>()

export function beginRequest(id: string): AbortSignal {
  running.get(id)?.abort()
  const controller = new AbortController()
  running.set(id, controller)
  return controller.signal
}

export function endRequest(id: string): void {
  running.delete(id)
}

export function cancelRequest(id: string): void {
  const controller = running.get(id)
  if (controller) controller.abort()
  running.delete(id)
}

export class CanceledError extends Error {
  constructor() {
    super('Canceled.')
  }
}

// ---------- HTTP ----------

function headers(json = true): Record<string, string> {
  const out: Record<string, string> = { 'User-Agent': 'YTD-Studio', Accept: 'application/json' }
  if (json) out['Content-Type'] = 'application/json'
  const key = apiKey()
  if (key && keyAllowedFor(aiHost())) out.Authorization = 'Bearer ' + key
  return out
}

async function errorFrom(response: Response, what: string): Promise<Error> {
  let detail = ''
  try {
    const text = await response.text()
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      detail = typeof parsed.error === 'string' ? parsed.error : text
    } catch {
      detail = text
    }
  } catch {
    /* no body */
  }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 300)
  const host = aiHost()
  if (response.status === 401 || response.status === 403) {
    return new Error(
      (isCloudHost(host) ? 'Ollama Cloud' : host) + ' rejected the request (' + response.status + '). ' +
        (apiKey() ? 'Check the API key in Settings > AI.' : 'Add your Ollama API key in Settings > AI.') +
        (detail ? ' (' + detail + ')' : ''),
    )
  }
  if (response.status === 429) return new Error('Ollama usage limit reached for now (429). Try again later or pick a smaller model.' + (detail ? ' (' + detail + ')' : ''))
  if (response.status === 404 && /model/i.test(detail)) return new Error('Model "' + settings.get('aiModel') + '" is not available on ' + host + '. Pick another one in Settings > AI.')
  return new Error(what + ' failed (' + response.status + ')' + (detail ? ': ' + detail : ''))
}

function linkSignals(signal: AbortSignal | undefined, idle: AbortController): AbortSignal {
  const list = [idle.signal, AbortSignal.timeout(TOTAL_TIMEOUT)]
  if (signal) list.push(signal)
  return AbortSignal.any(list)
}

function networkError(err: unknown, signal: AbortSignal | undefined, idleFired: boolean): Error {
  if (signal?.aborted) return new CanceledError()
  if (idleFired) return new Error('The model stopped responding (no data for ' + Math.round(IDLE_TIMEOUT / 1000) + 's). Try again or pick a faster model.')
  const message = err instanceof Error ? err.message : String(err)
  if (/timeout/i.test(message)) return new Error('The model took too long to answer. Try again or pick a faster model.')
  return new Error('Could not reach ' + aiHost() + ' (' + message + '). Check your connection and the server address in Settings > AI.')
}

// ---------- chat ----------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions {
  /** 'json' or a JSON schema: structured output. */
  format?: 'json' | Record<string, unknown>
  signal?: AbortSignal
  /** Streamed answer text as it arrives. */
  onDelta?: (text: string) => void
  /** The model is reasoning before it answers (thinking models). */
  onThinking?: () => void
  /** Ask a local server for a bigger context window (transcripts). Cloud models have large windows already. */
  longContext?: boolean
  temperature?: number
}

export function requireReady(): string {
  const status = aiStatus()
  if (status.isCloud && !status.hasKey) throw new Error('Add your Ollama API key in Settings > AI first.')
  if (!status.model) throw new Error('Pick a model in Settings > AI first.')
  return status.model
}

/** One chat call, streamed internally so long generations stay alive and thinking is visible. Returns the full answer. */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const model = requireReady()
  const options: Record<string, unknown> = {}
  if (opts.temperature !== undefined) options.temperature = opts.temperature
  if (opts.longContext && !isCloudHost()) options.num_ctx = 32768
  const body: Record<string, unknown> = { model, messages, stream: true }
  if (opts.format) body.format = opts.format
  if (Object.keys(options).length) body.options = options

  const idle = new AbortController()
  let idleFired = false
  let idleTimer: NodeJS.Timeout | null = null
  const touch = (): void => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      idleFired = true
      idle.abort()
    }, IDLE_TIMEOUT)
  }
  touch()
  const signal = linkSignals(opts.signal, idle)
  try {
    let response: Response
    try {
      response = await fetch(aiHost() + '/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify(body), signal })
    } catch (err) {
      throw networkError(err, opts.signal, idleFired)
    }
    if (!response.ok) {
      const error = await errorFrom(response, 'Chat')
      // Some models or servers reject structured output; ask again in plain JSON mode.
      if (response.status === 400 && opts.format && typeof opts.format === 'object' && /format|schema|grammar/i.test(error.message)) {
        log('ai: schema format rejected, retrying with format=json')
        return chat(messages, { ...opts, format: 'json' })
      }
      throw error
    }
    if (!response.body) throw new Error('Empty response from ' + aiHost())
    let content = ''
    let buffer = ''
    let sawThinking = false
    const decoder = new TextDecoder()
    const handleLine = (line: string): void => {
      if (!line.trim()) return
      let chunk: { message?: { content?: string; thinking?: string }; error?: string; done?: boolean }
      try {
        chunk = JSON.parse(line)
      } catch {
        return
      }
      if (chunk.error) throw new Error('Ollama: ' + chunk.error)
      const thinking = chunk.message?.thinking
      if (thinking && !sawThinking) {
        sawThinking = true
        opts.onThinking?.()
      }
      const piece = chunk.message?.content
      if (piece) {
        content += piece
        opts.onDelta?.(piece)
      }
    }
    try {
      const reader = response.body.getReader()
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        touch()
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        lines.forEach(handleLine)
      }
      handleLine(buffer)
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Ollama: ')) throw err
      throw networkError(err, opts.signal, idleFired)
    }
    return content.trim()
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

/** Pull the JSON object out of a reply (tolerates code fences and chatter around it). */
export function parseJsonReply<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  try {
    return JSON.parse(cleaned) as T
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T
    throw new Error('The model did not return valid JSON.')
  }
}

/** Structured output: a JSON schema in `format`, and one retry if the reply still is not valid JSON. */
export async function chatJson<T>(messages: ChatMessage[], schema: Record<string, unknown>, opts: ChatOptions = {}): Promise<T> {
  const first = await chat(messages, { ...opts, format: schema })
  try {
    return parseJsonReply<T>(first)
  } catch {
    log('ai: invalid JSON reply, asking again')
    const second = await chat(
      [...messages, { role: 'assistant', content: first.slice(0, 4000) }, { role: 'user', content: 'That was not valid JSON. Reply again with only the JSON object that matches the schema, nothing else.' }],
      { ...opts, format: schema },
    )
    return parseJsonReply<T>(second)
  }
}

// ---------- models ----------

export async function listModels(): Promise<AiModel[]> {
  let response: Response
  try {
    response = await fetch(aiHost() + '/api/tags', { headers: headers(false), signal: AbortSignal.timeout(20000) })
  } catch (err) {
    throw networkError(err, undefined, false)
  }
  if (!response.ok) throw await errorFrom(response, 'Listing models')
  const data = (await response.json()) as {
    models?: { name?: string; model?: string; size?: number; modified_at?: string; details?: { parameter_size?: string; family?: string } }[]
  }
  return (data.models ?? [])
    .map(function (m): AiModel {
      return {
        name: m.name || m.model || '',
        size: typeof m.size === 'number' && m.size > 0 ? m.size : null,
        parameterSize: m.details?.parameter_size || null,
        family: m.details?.family || null,
        modifiedAt: m.modified_at || null,
      }
    })
    .filter(function (m) { return !!m.name })
    .sort(function (a, b) { return a.name.localeCompare(b.name) })
}

// ---------- web search ----------

export interface WebResult {
  title: string
  url: string
  content: string
}

/** Ollama's hosted web search (always on ollama.com, needs a key even when chatting with a local server). */
export async function webSearch(query: string, maxResults: number, signal?: AbortSignal): Promise<WebResult[]> {
  if (!apiKey()) throw new Error('Web search needs an Ollama API key.')
  let response: Response
  try {
    response = await fetch(WEB_SEARCH_URL, {
      method: 'POST',
      headers: { ...headers(), Authorization: 'Bearer ' + apiKey() },
      body: JSON.stringify({ query, max_results: Math.max(1, Math.min(10, maxResults)) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    })
  } catch (err) {
    if (signal?.aborted) throw new CanceledError()
    throw new Error('Web search failed: ' + (err instanceof Error ? err.message : String(err)))
  }
  if (!response.ok) throw await errorFrom(response, 'Web search')
  const data = (await response.json()) as { results?: { title?: string; url?: string; content?: string }[] }
  return (data.results ?? []).map(function (r) {
    return { title: r.title ?? '', url: r.url ?? '', content: (r.content ?? '').slice(0, 600) }
  })
}
