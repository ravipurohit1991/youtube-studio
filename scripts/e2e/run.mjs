// End-to-end test of the desktop app without YouTube access.
//
// Drives the real Electron build (run `pnpm build` first) with Playwright. yt-dlp is replaced by
// scripts/e2e/fake-ytdlp, which prints the same lines the real one does (progress template,
// destinations, [Merger], --print-to-file), and googlevideo by a local server that, like the real
// one, only answers bounded Range requests carrying the client's headers.
//
//   pnpm build && pnpm test:e2e          (Linux: wrap in xvfb-run -a)
//
// Needs python3 and ffmpeg on PATH (ffmpeg makes the sample media and is handed to the app).

import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright-core')
const electronPath = require('electron')

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const WORK = mkdtempSync(join(tmpdir(), 'ytd-e2e-'))
const results = []
const check = (name, ok, extra = '') => {
  results.push(ok)
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  (' + extra + ')' : ''))
}

function which(cmd) {
  return execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
}

// ---- fixtures
const ffmpeg = which('ffmpeg')
const media = join(WORK, 'media')
mkdirSync(media, { recursive: true })
const ff = (args) => execFileSync(ffmpeg, ['-loglevel', 'error', '-y', ...args])
ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-t', '20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(media, 'video.mp4')])
ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:a', 'aac', join(media, 'audio.m4a')])
ff(['-i', join(media, 'video.mp4'), '-i', join(media, 'audio.m4a'), '-c', 'copy', '-movflags', '+faststart', join(media, 'muxed.mp4')])
const fake = join(WORK, 'fake-ytdlp')
copyFileSync(join(HERE, 'fake-ytdlp'), fake)
chmodSync(fake, 0o755)

const dl = join(WORK, 'downloads')
mkdirSync(dl, { recursive: true })
// Library fixtures: an MP4 and an MP3 of the same video, an unmerged leftover pair, in-progress work files.
copyFileSync(join(media, 'muxed.mp4'), join(dl, 'Song [xyzxyzxyz12].mp4'))
copyFileSync(join(media, 'audio.m4a'), join(dl, 'Song [xyzxyzxyz12].mp3'))
writeFileSync(join(dl, 'Song [xyzxyzxyz12].info.json'), JSON.stringify({ id: 'xyzxyzxyz12', title: 'Song Title', uploader: 'Band' }))
copyFileSync(join(media, 'video.mp4'), join(dl, 'Broken [qqqqqqqqq12].f137.mp4'))
copyFileSync(join(media, 'audio.m4a'), join(dl, 'Broken [qqqqqqqqq12].f140.m4a'))
copyFileSync(join(media, 'video.mp4'), join(dl, 'Work [wwwwwwwww12].mp4.part'))
copyFileSync(join(media, 'video.mp4'), join(dl, 'Tmp [ttttttttt12].temp.mp4'))

const config = join(WORK, 'config')
const settings = { downloadsDir: dl, ytdlpPath: fake, ffmpegPath: ffmpeg, lastTab: 'download', preferredHeight: 1080, concurrentDownloads: 2 }
for (const name of ['YTD Studio', 'ytd-studio']) {
  mkdirSync(join(config, name), { recursive: true })
  writeFileSync(join(config, name, 'settings.json'), JSON.stringify(settings))
}

// ---- fake googlevideo
const serverLog = join(WORK, 'server.log')
const server = createServer((req, res) => {
  const range = req.headers.range || ''
  appendFileSync(serverLog, JSON.stringify({ url: req.url, range, check: req.headers['x-client-check'] || null }) + '\n')
  const m = /^bytes=(\d+)-(\d+)$/.exec(range)
  if (req.headers['x-client-check'] !== 'visionos' || !m) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  let body
  try {
    body = readFileSync(join(media, req.url.split('?')[0]))
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  const start = Number(m[1])
  const end = Math.min(Number(m[2]), body.length - 1)
  res.writeHead(206, {
    'Content-Type': req.url.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${body.length}`,
    'Accept-Ranges': 'bytes',
  })
  res.end(body.subarray(start, end + 1))
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const mediaBase = 'http://127.0.0.1:' + server.address().port

// ---- fake Ollama: /api/tags plus streamed /api/chat answers picked by what each AI step asks for
const AI_KEY = 'test-key-e2e-7f3a'
const aiCalls = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function streamChat(res, text, thinking = false) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  if (thinking) res.write(JSON.stringify({ message: { role: 'assistant', content: '', thinking: 'Let me think.' }, done: false }) + '\n')
  for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) {
    res.write(JSON.stringify({ message: { role: 'assistant', content: piece }, done: false }) + '\n')
    await sleep(15)
  }
  res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n')
}
const ollama = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const body = raw ? JSON.parse(raw) : null
    aiCalls.push({ path: req.url, auth: req.headers.authorization || null, body })
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: [{ name: 'gpt-oss:20b', size: 13e9, details: { parameter_size: '20.9B' } }, { name: 'gpt-oss:120b', details: { parameter_size: '116.8B' } }] }))
      return
    }
    if (req.url !== '/api/chat') {
      res.writeHead(404)
      res.end('{}')
      return
    }
    const props = body.format && body.format.properties ? body.format.properties : {}
    const user = body.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    const system = body.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    if (props.queries) {
      return streamChat(res, JSON.stringify({ intent: 'You want calm music to study to.', queries: [{ q: 'lofi study beats', sort: 'relevance' }, { q: 'chill study music', sort: 'date' }], recency: 'any', minMinutes: 0, maxMinutes: 0, allowShorts: false }), true)
    }
    if (props.picks) {
      // Rank in reverse order of the list, so the test can tell the model's order was used.
      const n = user.split('\n').filter((l) => /^\d+\. /.test(l)).length
      const picks = Array.from({ length: n }, (_, k) => ({ i: n - k, score: 95 - k * 4, why: 'Pick ' + (k + 1) + ' because it fits.' })).filter((p) => p.score >= 40)
      return streamChat(res, '```json\n' + JSON.stringify({ picks }) + '\n```')
    }
    if (props.groups) {
      return streamChat(res, JSON.stringify({ groups: [{ name: 'Test Mix', description: 'All the test clips', items: [1, 2, 3] }, { name: 'More Clips', description: 'The rest', items: [4, 5, 6] }] }))
    }
    if (/TL;DW/.test(system)) {
      return streamChat(res, '## TL;DW\nA **test clip** with a tone.\n\n## Key moments\n- [00:03] The tone starts\n- [00:12] Halfway point\n\n## Worth watching?\nOnly for tests.', true)
    }
    if (/answer questions about one YouTube video/.test(system)) return streamChat(res, 'It says hello at [00:02].')
    return streamChat(res, 'YTD Studio is connected.')
  })
})
await new Promise((resolve) => ollama.listen(0, '127.0.0.1', resolve))
const ollamaHost = 'http://127.0.0.1:' + ollama.address().port

const env = { ...process.env, XDG_CONFIG_HOME: config, APPDATA: config, FAKE_MEDIA_BASE: mediaBase }
delete env.ELECTRON_RUN_AS_NODE
delete env.OLLAMA_API_KEY
const app = await _electron.launch({ executablePath: electronPath, args: ['--no-sandbox', REPO], cwd: REPO, env })
let exitCode = 1
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30000 })

  // ---- Download: queue + live progress + stages + processing + completion
  await page.click('button.nav-item:has-text("Download")')
  await page.fill('input[placeholder^="https://www.youtube.com/watch?v=... or"]', 'https://www.youtube.com/watch?v=abc123def45')
  await page.click('button:has-text("Analyze")')
  await page.waitForSelector('h2:has-text("Test Clip")', { timeout: 20000 })
  check('analyze shows the title', true)
  await page.click('button:has-text("Download video")')
  const appeared = await page.locator('.job').first().waitFor({ timeout: 5000 }).then(() => true, () => false)
  check('job appears in the queue right away', appeared)
  const stages = new Set()
  const percents = new Set()
  let busyBar = false
  const started = Date.now()
  while (Date.now() - started < 30000) {
    const snap = await page.evaluate(() => {
      const el = document.querySelector('.job')
      if (!el) return null
      return {
        stage: el.querySelector('.job-stage')?.textContent ?? '',
        spans: [...el.querySelectorAll('.job-sub > span')].map((x) => x.textContent),
        busy: !!el.querySelector('.progress.busy'),
      }
    })
    if (!snap) break // finished jobs leave the queue for History
    if (snap.stage) stages.add(snap.stage)
    if (snap.busy) busyBar = true
    snap.spans.forEach((t) => {
      const m = /^(\d{1,3})%$/.exec(t)
      if (m) percents.add(Number(m[1]))
    })
    await page.waitForTimeout(120)
  }
  console.log('  stages:', [...stages].join(' > '))
  console.log('  percents:', [...percents].sort((a, b) => a - b).join(','))
  check('percent updates live', percents.size >= 4)
  check('shows "Fetching video info"', stages.has('Fetching video info'))
  check('shows "Downloading video"', stages.has('Downloading video'))
  check('labels the second (audio) stream', [...stages].some((s) => /audio track/.test(s)))
  check('shows "Merging video and audio"', stages.has('Merging video and audio'))
  check('animated bar while waiting/processing', busyBar)
  await page.click('button:has-text("History")')
  const done = await page.waitForSelector('.job .chip.ok', { timeout: 10000 }).then(() => true, () => false)
  check('job completes and moves to History', done)
  await page.click('.job button[title="Remove from list"]')
  await page.waitForTimeout(800)
  check('removed job stays removed', (await page.locator('.job').count()) === 0)

  // ---- Library
  await page.click('button.nav-item:has-text("Library")')
  await page.waitForSelector('.lib-card', { timeout: 10000 })
  await page.waitForTimeout(500)
  const names = await page.$$eval('.lib-name', (els) => els.map((e) => e.textContent))
  console.log('  library:', names.join(' | '))
  check('library: download listed once', names.filter((n) => n.startsWith('Test Clip')).length === 1)
  check('library: MP4 and MP3 of one video both listed', names.filter((n) => n.startsWith('Song Title')).length === 2)
  check('library: unmerged pieces shown as one item', names.filter((n) => n.startsWith('Broken')).length === 1)
  check('library: .part/.temp work files hidden', !names.some((n) => /^(Work|Tmp)/.test(n)))
  check('no leftover format pieces on disk', !readdirSync(dl).some((f) => f.startsWith('Test Clip') && /\.f\d+\./.test(f)))

  // ---- Stream
  await page.click('button.nav-item:has-text("Stream")')
  await page.fill('input[placeholder="https://www.youtube.com/watch?v=..."]', 'https://www.youtube.com/watch?v=abc123def45')
  await page.click('[data-tab="stream"] button:has-text("Play")')
  await page.waitForSelector('[data-tab="stream"] .video-frame video', { timeout: 20000 })
  const played = await page.evaluate(async () => {
    const v = document.querySelector('[data-tab="stream"] .video-frame video')
    const a = document.querySelector('[data-tab="stream"] .video-frame audio')
    v.muted = true
    try {
      await v.play()
    } catch {}
    const t0 = performance.now()
    while (performance.now() - t0 < 8000 && v.currentTime < 1.5) await new Promise((r) => setTimeout(r, 200))
    v.currentTime = 12
    await new Promise((r) => setTimeout(r, 1500))
    return { t: v.currentTime, err: v.error && v.error.code, audio: a ? { t: a.currentTime, err: a.error && a.error.code } : null }
  })
  check('stream plays and seeks', played.t >= 12 && !played.err, 't=' + played.t.toFixed(1))
  check('separate audio track follows the video', !!played.audio && Math.abs(played.audio.t - played.t) < 1.5 && !played.audio.err)
  const chips = await page.$$eval('.chip', (els) => els.map((e) => e.textContent))
  check('HLS-only 1080p rendition skipped for the player', !chips.some((c) => /1080/.test(c)))
  const upstream = readFileSync(serverLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  check('media host saw only bounded ranges with client headers', upstream.length > 0 && upstream.every((r) => /^bytes=\d+-\d+$/.test(r.range) && r.check === 'visionos'))

  // ---- Whole playlist: one click, own folder, playlist order, kept in sync
  await page.click('button.nav-item:has-text("Download")')
  await page.fill('input[placeholder^="https://www.youtube.com/watch?v=... or"]', 'https://www.youtube.com/playlist?list=PLtest123')
  await page.click('button:has-text("Analyze")')
  await page.waitForSelector('h2:has-text("Test Playlist")', { timeout: 20000 })
  await page.click('button:has-text("Download whole playlist")')
  const folder = join(dl, 'Test Playlist')
  const waitFor = async (fn, ms) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      if (await fn()) return true
      await page.waitForTimeout(250)
    }
    return false
  }
  const listFolder = () => {
    try {
      return readdirSync(folder).filter((f) => /^\d{3} - .*\]\.mp4$/.test(f)).sort()
    } catch {
      return []
    }
  }
  const twoSaved = await waitFor(() => listFolder().length >= 2, 40000)
  console.log('  playlist folder:', listFolder().join(' | '))
  check('playlist downloads into its own folder', twoSaved)
  check('playlist files numbered in order', listFolder()[0] === '001 - Test Clip [abc123def45].mp4' && listFolder()[1] === '002 - Second Clip [def456ghi78].mp4')
  check('playlist is saved for syncing', (await page.locator('.saved-row:has-text("Test Playlist")').count()) === 1)

  await page.click('button.nav-item:has-text("Playlists")')
  await page.waitForSelector('.pl-item:has-text("Test Playlist")', { timeout: 10000 })
  await page.click('.pl-item:has-text("Test Playlist")')
  await page.waitForSelector('.pl-row', { timeout: 10000 })
  const rows = await page.$$eval('.pl-row .pl-row-title', (els) => els.map((e) => e.textContent))
  console.log('  playlist rows:', rows.join(' | '))
  check('Playlists tab lists the playlist in order', rows.length === 2 && rows[0] === 'Test Clip' && rows[1] === 'Second Clip')

  writeFileSync(join(WORK, 'playlist-extra'), '1')
  await page.click('button:has-text("Sync new videos")')
  const synced = await waitFor(() => listFolder().length >= 3, 40000)
  check('sync downloads only the newly added video', synced && listFolder()[2] === '003 - Third Clip [ghi789jkl01].mp4' && listFolder().length === 3)

  // ---- Organize: favorites and a playlist of your own
  await page.click('button.nav-item:has-text("Library")')
  await page.click('.toolbar button:has-text("Rescan")')
  await page.waitForTimeout(1200)
  const firstCard = page.locator('.lib-card').first()
  const favTitle = await firstCard.locator('.lib-name').textContent()
  await firstCard.hover()
  await firstCard.locator('.fav-btn').click()
  await page.waitForTimeout(400)
  await page.click('.segmented button:has-text("Favorites")')
  await page.waitForTimeout(300)
  const favNames = await page.$$eval('.lib-name', (els) => els.map((e) => e.textContent))
  check('favorite shows under Favorites', favNames.length === 1 && favNames[0] === favTitle)
  await page.click('.lib-card button[title="Add to playlist"]')
  await page.fill('.modal input', 'My Mix')
  await page.click('.modal button:has-text("Create")')
  await page.waitForTimeout(400)
  await page.click('button.nav-item:has-text("Playlists")')
  await page.click('.pl-item:has-text("My Mix")')
  await page.waitForSelector('.pl-row', { timeout: 5000 })
  check('own playlist holds the added item', (await page.$$eval('.pl-row .pl-row-title', (els) => els.map((e) => e.textContent))).join() === favTitle)

  // ---- Watch: playback position is remembered and resumed
  await page.click('.pl-detail button:has-text("Play all")')
  await page.waitForSelector('.overlay video', { timeout: 10000 })
  await page.evaluate(async () => {
    const v = document.querySelector('.overlay video')
    v.muted = true
    const t0 = performance.now()
    while (performance.now() - t0 < 8000 && v.readyState < 1) await new Promise((r) => setTimeout(r, 100))
    v.currentTime = 9
    await new Promise((r) => setTimeout(r, 600))
    v.pause()
  })
  await page.waitForTimeout(500)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1200)
  await page.click('.pl-detail button:has-text("Play all")')
  const resumed = await page.waitForSelector('.overlay .chip:has-text("Resumed at")', { timeout: 10000 }).then(() => true, () => false)
  check('player resumes where it was left off', resumed)
  await page.keyboard.press('Escape')
  const stateFile = ['YTD Studio', 'ytd-studio'].map((n) => join(config, n, 'library-state.json')).find((f) => {
    try {
      readFileSync(f)
      return true
    } catch {
      return false
    }
  })
  await page.waitForTimeout(1000)
  const saved = stateFile ? JSON.parse(readFileSync(stateFile, 'utf8')) : null
  check('favorites, playlists and progress persist to disk', !!saved && saved.favorites.length === 1 && saved.playlists.length === 1 && Object.values(saved.progress).some((p) => p.position > 5))

  // ---- AI: settings (server, key, model), Discover, video insights, smart playlists
  await page.click('button.nav-item:has-text("Discover")')
  check('Discover asks to set up AI first', (await page.locator('[data-tab="discover"] button:has-text("Set up AI")').count()) === 1)
  await page.click('[data-tab="discover"] button:has-text("Set up AI")')
  await page.waitForSelector('#ai-settings', { timeout: 5000 })
  await page.fill('#ai-host', ollamaHost)
  await page.press('#ai-host', 'Enter')
  await page.fill('#ai-key', AI_KEY)
  await page.click('#ai-settings button:has-text("Save key")')
  const modelPicked = await waitFor(async () => (await page.inputValue('#ai-model').catch(() => '')) === 'gpt-oss:120b', 10000)
  check('models are listed and a strong default is picked', modelPicked)
  await page.click('#ai-settings button:has-text("Test")')
  const tested = await page.waitForSelector('#ai-settings :text("answered in")', { timeout: 10000 }).then(() => true, () => false)
  check('connection test talks to the model', tested)
  check('the API key is sent as a Bearer token', aiCalls.some((c) => c.path === '/api/chat' && c.auth === 'Bearer ' + AI_KEY))
  const settingsText = ['YTD Studio', 'ytd-studio'].map((n) => { try { return readFileSync(join(config, n, 'settings.json'), 'utf8') } catch { return '' } }).join('')
  check('the API key is not written to settings.json', settingsText.includes('gpt-oss:120b') && !settingsText.includes(AI_KEY))
  const keyInRenderer = await page.evaluate((key) => document.documentElement.outerHTML.includes(key), AI_KEY)
  check('the renderer never sees the API key', !keyInRenderer)

  await page.click('button.nav-item:has-text("Discover")')
  await page.fill('.discover-input', 'calm music to study to')
  await page.click('button:has-text("Find videos")')
  const found = await page.waitForSelector('.disc-card', { timeout: 30000 }).then(() => true, () => false)
  check('Discover returns ranked videos', found)
  const planCall = aiCalls.find((c) => c.body && c.body.format && c.body.format.properties && c.body.format.properties.queries)
  const rankCall = aiCalls.find((c) => c.body && c.body.format && c.body.format.properties && c.body.format.properties.picks)
  const listed = rankCall ? rankCall.body.messages.find((m) => m.role === 'user').content.split('\n').filter((l) => /^\d+\. /.test(l)) : []
  const cards = await page.$$eval('.disc-card .lib-name', (els) => els.map((e) => e.textContent))
  console.log('  discover:', cards.join(' | '))
  check('plan request carries the prompt and a taste profile from the library', !!planCall && /calm music to study to/.test(planCall.body.messages[1].content) && /Song Title|Test Clip/.test(planCall.body.messages[1].content))
  check('model ranking decides the order', listed.length > 2 && cards[0] === listed[listed.length - 1].replace(/^\d+\. /, '').split(' | ')[0])
  check('shorts, live streams, channels and owned videos are filtered out', listed.length === 8 && !listed.some((l) => /A short about|LIVE |A channel|Song Title/.test(l)))
  check('each pick shows a match score and a reason', (await page.locator('.disc-card .match').count()) === cards.length && (await page.locator('.disc-card .reason').first().textContent()).includes('because it fits'))
  const ytCalls = readFileSync(join(WORK, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const searches = ytCalls.map((c) => c.args[c.args.length - 1]).filter((u) => u.includes('results?search_query='))
  console.log('  searches:', searches.join(' | '))
  // EgIQAQ== is "type: video"; CAISAhAB is "sort by upload date" + "type: video".
  check('searches use YouTube filters (videos only, per-query sort)', searches.length === 2 && searches.some((u) => u.includes('sp=EgIQAQ%3D%3D')) && searches.some((u) => u.includes('sp=CAISAhAB')))

  const disliked = cards[1]
  await page.locator('.disc-card').nth(1).locator('button[title="Less like this"]').click()
  await page.waitForTimeout(500)
  const afterVote = await page.$$eval('.disc-card .lib-name', (els) => els.map((e) => e.textContent))
  const tasteFile = ['YTD Studio', 'ytd-studio'].map((n) => join(config, n, 'ai-taste.json')).find((f) => { try { readFileSync(f); return true } catch { return false } })
  const tasteSaved = tasteFile ? JSON.parse(readFileSync(tasteFile, 'utf8')) : null
  check('thumbs down hides the video and is remembered', !afterVote.includes(disliked) && !!tasteSaved && tasteSaved.disliked.some((d) => d.title === disliked))

  const before = aiCalls.length
  await page.click('.chip-btn:has-text("Shorter")')
  await page.waitForSelector('[data-tab="discover"] :text("Refined:")', { timeout: 30000 })
  const refineCall = aiCalls.slice(before).find((c) => c.body && c.body.format && c.body.format.properties && c.body.format.properties.queries)
  check('refining sends the follow-up with the original request', !!refineCall && /Follow-up adjustments[\s\S]*shorter/.test(refineCall.body.messages[1].content) && /calm music to study to/.test(refineCall.body.messages[1].content))
  check('disliked suggestions feed back into the profile', !!refineCall && refineCall.body.messages[1].content.includes(disliked))

  // Insights on the stream page: streamed summary with clickable key moments, then a question.
  // The Stream tab stays mounted, so the earlier test's <video> is still there: wait for a new stream session.
  const oldSrc = await page.evaluate(() => document.querySelector('[data-tab="stream"] .video-frame video')?.src ?? '')
  await page.locator('.disc-card').first().locator('button:has-text("Play")').click()
  await page.waitForFunction((old) => {
    const v = document.querySelector('[data-tab="stream"] .video-frame video')
    return !!v && v.src !== old && !document.querySelector('[data-tab="stream"] .loading-row')
  }, oldSrc, { timeout: 20000 })
  await page.evaluate(() => { document.querySelector('[data-tab="stream"] .video-frame video').muted = true })
  await page.click('[data-tab="stream"] .ai-card button:has-text("Summarize")')
  const summarized = await page.waitForSelector('[data-tab="stream"] .ai-summary .stamp:has-text("00:12")', { timeout: 20000 }).then(() => true, () => false)
  check('summary streams in with key moments', summarized && (await page.locator('[data-tab="stream"] .ai-summary h4').count()) === 3)
  const sumCall = aiCalls.find((c) => c.body && c.body.messages && /TL;DW/.test(c.body.messages[0].content))
  check('summary is built from the captions (rolling lines collapsed)', !!sumCall && /\[00:01\] hello from the captions the tone starts halfway & still going/.test(sumCall.body.messages[1].content))
  await page.click('[data-tab="stream"] .ai-summary .stamp:has-text("00:12")')
  await page.waitForTimeout(800)
  const jumped = await page.evaluate(() => document.querySelector('[data-tab="stream"] .video-frame video').currentTime)
  check('clicking a key moment seeks the player', jumped >= 11.5, 't=' + jumped.toFixed(1))
  await page.fill('[data-tab="stream"] .ai-card input', 'What does it say first?')
  await page.press('[data-tab="stream"] .ai-card input', 'Enter')
  const answered = await page.waitForSelector('[data-tab="stream"] .bubble.assistant .stamp:has-text("00:02")', { timeout: 15000 }).then(() => true, () => false)
  check('questions about the video get answers with timestamps', answered)
  await page.evaluate(() => document.querySelector('[data-tab="stream"] .video-frame video').pause())

  // Smart playlists: grouped by the model, created only after confirming.
  await page.click('button.nav-item:has-text("Playlists")')
  await page.click('button:has-text("Smart playlists (AI)")')
  await page.waitForSelector('.smart-group', { timeout: 20000 })
  await page.click('.smart-modal button:has-text("Create 2 playlist(s)")')
  const smartMade = await page.waitForSelector('.pl-item:has-text("Test Mix")', { timeout: 10000 }).then(() => true, () => false)
  check('smart playlists are created from the AI grouping', smartMade && (await page.locator('.pl-item:has-text("More Clips")').count()) === 1)

  // ---- yt-dlp invocation
  const calls = readFileSync(join(WORK, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((c) => c.args[0] !== '--version')
  check('yt-dlp gets --js-runtimes node:<app executable>', calls.length > 0 && calls.every((c) => (c.args[c.args.indexOf('--js-runtimes') + 1] || '').startsWith('node:')))
  check('yt-dlp runs with ELECTRON_RUN_AS_NODE=1', calls.every((c) => c.run_as_node === '1'))
  exitCode = results.every(Boolean) ? 0 : 1
} catch (err) {
  console.error(err)
} finally {
  await app.close().catch(() => undefined)
  server.close()
  ollama.close()
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  if (exitCode === 0) rmSync(WORK, { recursive: true, force: true })
  else console.log('work dir kept for inspection:', WORK)
  process.exit(exitCode)
}
