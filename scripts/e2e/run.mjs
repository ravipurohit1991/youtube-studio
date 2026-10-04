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

const env = { ...process.env, XDG_CONFIG_HOME: config, APPDATA: config, FAKE_MEDIA_BASE: mediaBase }
delete env.ELECTRON_RUN_AS_NODE
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
  await page.click('button:has-text("Play")')
  await page.waitForSelector('.video-frame video', { timeout: 20000 })
  const played = await page.evaluate(async () => {
    const v = document.querySelector('.video-frame video')
    const a = document.querySelector('.video-frame audio')
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
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
  if (exitCode === 0) rmSync(WORK, { recursive: true, force: true })
  else console.log('work dir kept for inspection:', WORK)
  process.exit(exitCode)
}
