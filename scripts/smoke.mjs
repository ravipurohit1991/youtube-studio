// End-to-end UI smoke test. Attaches to the running app over the Chrome DevTools
// Protocol, drives real interactions and reports pass/fail for every behaviour.
//
//   Start-Process node_modules/electron/dist/electron.exe -ArgumentList '.', '--remote-debugging-port=9222'
//   node scripts/smoke.mjs [videoUrl]

const TEST_URL = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw'
const EXPECTED_TITLE_FRAGMENT = 'zoo'
const PORT = 9222

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.events = []
  }
  static async open(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('could not open the devtools websocket'))
    })
    const client = new CDP(ws)
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id && client.pending.has(message.id)) {
        const handlers = client.pending.get(message.id)
        client.pending.delete(message.id)
        if (message.error) handlers.reject(new Error(JSON.stringify(message.error)))
        else handlers.resolve(message.result)
        return
      }
      client.events.push(message)
    }
    return client
  }
  send(method, params) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params: params || {} }))
    })
  }
  async eval(expression, awaitPromise) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: awaitPromise !== false,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      const text = details.exception ? details.exception.description : details.text
      throw new Error(text)
    }
    return result.result.value
  }
  close() {
    this.ws.close()
  }
}

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function record(name, ok, detail) {
  results.push({ name, ok })
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ::  ' + detail : ''))
}

let cdp

// Every step is isolated so one broken check cannot abort the run.
async function step(name, fn) {
  try {
    const detail = await fn()
    record(name, true, typeof detail === 'string' ? detail : '')
    return true
  } catch (error) {
    record(name, false, error.message)
    return false
  }
}

const js = (value) => JSON.stringify(value)
const PANEL = (tab) => 'document.querySelector(' + js('[data-tab=' + js(tab) + '] .panel-scroll') + ')'
const ACTIVE_TAB = 'document.querySelector(".topbar h1").innerText'
const OPEN_TAB = (tab) => `[...document.querySelectorAll('.nav-item')].find(function (n) { return n.innerText.trim().indexOf(${js(tab)}) >= 0 }).click()`
const CLICK = (label) => `[...document.querySelectorAll('button')].find(function (b) { return (b.innerText || '').indexOf(${js(label)}) >= 0 }).click()`

async function findTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + PORT + '/json/list')
      const list = await response.json()
      const page = list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // devtools endpoint is not up yet
    }
    await sleep(500)
  }
  throw new Error('no debuggable page on port ' + PORT)
}

async function waitFor(expression, timeoutMs, intervalMs) {
  const deadline = Date.now() + (timeoutMs || 60000)
  for (;;) {
    const value = await cdp.eval(expression)
    if (value) return value
    if (Date.now() > deadline) return null
    await sleep(intervalMs || 500)
  }
}

async function main() {
  const target = await findTarget()
  console.log('attached to: ' + target.title)
  cdp = await CDP.open(target.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable')

  console.log('')
  console.log('--- shell ---')
  await step('sidebar renders all four tabs', async () => {
    const nav = await cdp.eval("[...document.querySelectorAll('.nav-item')].map(function (b) { return b.innerText.trim() })")
    if (nav.length !== 4) throw new Error('found ' + nav.length + ' nav items')
    return JSON.stringify(nav)
  })
  await step('tool status pills render', async () => {
    const pills = await cdp.eval("[...document.querySelectorAll('.tool-pill')].map(function (p) { return p.innerText.trim().split(String.fromCharCode(10)).join(': ') })")
    if (pills.length !== 3) throw new Error('found ' + pills.length + ' pills')
    return JSON.stringify(pills)
  })
  await step('yt-dlp is installed (no warning banner)', async () => {
    const banner = await cdp.eval('!!document.querySelector(".banner")')
    if (banner) throw new Error('the missing-tool banner is showing')
    return ''
  })

  console.log('')
  console.log('--- settings tab ---')
  await cdp.eval(OPEN_TAB('Settings'))
  await sleep(700)
  const settingsText = await cdp.eval(PANEL('settings') + '.innerText')
  const inSettings = (needle) => settingsText.indexOf(needle) >= 0
  record('settings shows the downloads folder', inSettings('Downloads folder'), '')
  record('settings shows download defaults', inSettings('Download defaults') && inSettings('Preferred resolution'), '')
  record('settings shows tool state', inSettings('yt-dlp') && inSettings('ffmpeg'), '')
  record('settings shows the local media server', inSettings('Local media server'), '')
  await step('yt-dlp update check reaches GitHub', async () => {
    const result = await cdp.eval('(async function () { var r = await window.api.checkYtdlpUpdate(true); return r.ok ? r.data : { error: r.error } })()')
    if (!result || !result.latest) throw new Error(JSON.stringify(result))
    return 'installed=' + (result.current || 'none') + ' latest=' + result.latest + ' updateAvailable=' + result.updateAvailable
  })

  console.log('')
  console.log('--- streaming ---')
  await cdp.eval(OPEN_TAB('Stream'))
  await sleep(500)
  await step('stream input accepts a link', async () => {
    const typed = await cdp.eval(`
      (function () {
        var input = document.querySelector('[data-tab="stream"] input.input')
        if (!input) throw new Error('stream input not found')
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, ${js(TEST_URL)})
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return input.value
      })()
    `)
    if (typed !== TEST_URL) throw new Error('input holds ' + typed)
    return typed
  })
  await sleep(400)
  await cdp.eval(CLICK('Play'))
  const ready = await waitFor(`
    (function () {
      var v = document.querySelector('[data-tab="stream"] .video-frame video')
      var a = document.querySelector('[data-tab="stream"] .video-frame audio')
      var el = a || v
      if (!el || el.readyState < 2) return null
      return {
        src: el.currentSrc || el.src,
        duration: Math.round(el.duration || 0),
        readyState: el.readyState,
        tag: a === el ? 'audio' : 'video',
        hasVideo: !!v,
        hasAudio: !!a,
      }
    })()
  `, 90000, 500)
  record('a playable stream is resolved', !!ready, ready ? ready.tag + ' readyState=' + ready.readyState + ' duration=' + ready.duration + 's' : 'no media element became ready')

  if (ready) {
    record('video and audio tracks both attached', ready.hasVideo && ready.hasAudio, 'video=' + ready.hasVideo + ' audio=' + ready.hasAudio)
    record('media is served from the local proxy', ready.src.indexOf('127.0.0.1') >= 0, ready.src)
    await step('proxy answers HTTP Range requests', async () => {
      const ranged = await fetch(ready.src, { headers: { Range: 'bytes=0-4095' } })
      const contentRange = ranged.headers.get('content-range')
      if (ranged.status !== 206 || !contentRange) throw new Error('status=' + ranged.status + ' range=' + contentRange)
      const body = await ranged.arrayBuffer()
      if (body.byteLength !== 4096) throw new Error('got ' + body.byteLength + ' bytes')
      return 'status=206 range=' + contentRange
    })
    await step('playback position advances', async () => {
      const t1 = await cdp.eval('(function () { var el = document.querySelector("[data-tab=\'stream\'] .video-frame audio") || document.querySelector("[data-tab=\'stream\'] .video-frame video"); return el ? el.currentTime : -1 })()')
      await sleep(3500)
      const t2 = await cdp.eval('(function () { var el = document.querySelector("[data-tab=\'stream\'] .video-frame audio") || document.querySelector("[data-tab=\'stream\'] .video-frame video"); return el ? el.currentTime : -1 })()')
      if (!(t2 > t1 + 0.5)) throw new Error('t1=' + t1.toFixed(2) + ' t2=' + t2.toFixed(2))
      return 't1=' + t1.toFixed(2) + 's t2=' + t2.toFixed(2) + 's'
    })
  }

  console.log('')
  console.log('--- download pipeline ---')
  const created = await cdp.eval(`
    (async function () {
      return await window.api.createJobs([{
        url: ${js(TEST_URL)},
        mode: 'audio_only',
        audioFormat: 'mp3',
        audioQuality: '0',
        title: 'smoke test audio',
      }])
    })()
  `)
  record('download job created through IPC', !!(created && created.ok), created && created.ok ? 'queued=' + created.data.length : JSON.stringify(created))
  const done = await waitFor(`
    (async function () {
      var res = await window.api.listJobs()
      if (!res.ok) return null
      var job = res.data.find(function (j) { return j.title === 'smoke test audio' })
      if (!job) return null
      if (job.status === 'completed' || job.status === 'error' || job.status === 'canceled') {
        return { status: job.status, percent: Math.round(job.percent), outputPath: job.outputPath, error: job.error }
      }
      return null
    })()
  `, 240000, 1500)
  record('audio download finishes', !!done && done.status === 'completed', JSON.stringify(done))
  record('finished job records the output file', !!(done && done.outputPath), done && done.outputPath ? done.outputPath : 'no outputPath returned')

  console.log('')
  console.log('--- library ---')
  await cdp.eval(OPEN_TAB('Library'))
  await sleep(700)
  await cdp.eval(CLICK('Rescan'))
  await sleep(3500)
  const cards = await cdp.eval("[...document.querySelectorAll('[data-tab=\"library\"] .lib-card')].map(function (c) { return c.innerText.split(String.fromCharCode(10)).join(' | ') })")
  record('library lists the downloaded file', Array.isArray(cards) && cards.length >= 1, JSON.stringify(cards))
  record('library shows the expected title', Array.isArray(cards) && cards.some((text) => text.indexOf(EXPECTED_TITLE_FRAGMENT) >= 0), '')

  console.log('')
  console.log('--- hygiene ---')
  const exceptions = cdp.events
    .filter((event) => event.method === 'Runtime.exceptionThrown')
    .map((event) => event.params.exceptionDetails.text)
  const consoleErrors = cdp.events
    .filter((event) => event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error')
    .map((event) => (event.params.args || []).map((arg) => arg.value || arg.description).join(' '))
  record('no uncaught renderer exceptions', exceptions.length === 0, JSON.stringify(exceptions))
  record('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors))

  cdp.close()
  const failed = results.filter((entry) => !entry.ok)
  console.log('')
  console.log('SUMMARY ' + (results.length - failed.length) + '/' + results.length + ' checks passed')
  if (failed.length) {
    console.log('failed: ' + failed.map((entry) => entry.name).join(' | '))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('smoke test crashed: ' + error.message)
  process.exitCode = 1
})
