// README screenshots of the desktop app, with fictional sample content.
//
//   pnpm build && node scripts/screenshots/capture.mjs [outDir]
//
// Like the e2e test, it runs the real app against a stand-in yt-dlp, a local media host and a fake
// Ollama, in a throwaway data folder. Thumbnails and the sample video are generated with ffmpeg
// (gradients + titles), so no real YouTube content appears. Needs python3 and ffmpeg (with drawtext).

import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeYtdlpCommand } from '../e2e/launcher.mjs'

const require = createRequire(import.meta.url)
const { _electron } = require('playwright-core')
const electronPath = require('electron')

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(REPO, 'docs', 'screenshots')
const WORK = mkdtempSync(join(tmpdir(), 'ytd-shots-'))
mkdirSync(OUT, { recursive: true })

const which = (cmd) => execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
const ffmpeg = which('ffmpeg')
const ff = (args) => execFileSync(ffmpeg, ['-loglevel', 'error', '-y', ...args])
const FONT = process.platform === 'win32' ? 'C\\:/Windows/Fonts/segoeuib.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

// ---- the fictional catalog
const V = (id, title, channel, duration, colors, words, extra = {}) => ({ id, title, channel, duration, colors, words, views: 40000 + id.length * 9137 * (duration % 17), ...extra })
const videos = [
  V('tokyoNight6', 'Night drive through Tokyo — 4K city ambience', 'City Walks', 3611, ['0x0c4a6e', '0xec4899', '0x1e1b4b'], ['TOKYO', 'NIGHTS']),
  V('lofiFocus01', 'Lo-fi beats to focus — 2 hour study mix', 'Quiet Rooms', 7260, ['0x3b1d60', '0xe5326f', '0x111827'], ['LO-FI', 'FOCUS']),
  V('tinyHouse02', 'I built a tiny house in 30 days (full build)', 'Northwood Builds', 1934, ['0x0f766e', '0xfacc15', '0x064e3b'], ['TINY', 'HOUSE']),
  V('blackHole03', 'What really happens inside a black hole?', 'Curious Cosmos', 1122, ['0x020617', '0x7c3aed', '0x1d4ed8'], ['BLACK', 'HOLES']),
  V('sourdough04', 'Sourdough from scratch: the complete guide', 'Crumb & Crust', 1588, ['0x78350f', '0xfbbf24', '0x431407'], ['SOUR', 'DOUGH']),
  V('rustCourse5', 'Rust in 100 minutes — build a real CLI tool', 'Dev Lanes', 6012, ['0x1e293b', '0xf97316', '0x0f172a'], ['RUST', '100 MIN']),
  V('jazzPiano07', 'Jazz piano for rainy evenings', 'Blue Keys', 4807, ['0x1e3a8a', '0x38bdf8', '0x0f172a'], ['RAINY', 'JAZZ']),
  V('yogaFlow008', '20-minute morning yoga flow for beginners', 'Stretch Studio', 1265, ['0x065f46', '0x6ee7b7', '0x134e4a'], ['MORNING', 'FLOW']),
  V('synthWave11', 'Synthwave mix — retro night drive', 'Neon Radio', 3540, ['0x4c1d95', '0xf472b6', '0x1e1b4b'], ['SYNTH', 'WAVE']),
  V('rainSounds9', 'Rain on a cabin roof — 3 hours', 'Quiet Rooms', 10800, ['0x334155', '0x94a3b8', '0x0f172a'], ['CABIN', 'RAIN']),
  V('focusCafe10', 'Coffee shop ambience for deep work', 'Quiet Rooms', 5400, ['0x7c2d12', '0xfdba74', '0x1c1917'], ['CAFE', 'FOCUS']),
  // Discover suggestions (not in the library).
  V('oceanDocu12', 'The deep ocean: life without light', 'Blue Planet Lab', 2950, ['0x082f49', '0x22d3ee', '0x0c4a6e'], ['DEEP', 'OCEAN'], { discover: true }),
  V('slowTrain13', 'Slow TV: a train through the Norwegian fjords', 'Rail Journeys', 6240, ['0x164e63', '0xa5f3fc', '0x1e293b'], ['FJORD', 'TRAIN'], { discover: true }),
  V('forestWalk4', 'A quiet walk through an old-growth forest', 'Trail Notes', 2710, ['0x14532d', '0xbef264', '0x052e16'], ['FOREST', 'WALK'], { discover: true }),
  V('starGazin15', "A beginner's guide to the night sky", 'Night Sky Club', 1820, ['0x0b1026', '0x818cf8', '0x312e81'], ['NIGHT', 'SKY'], { discover: true }),
  V('ambientPn16', 'Ambient piano for a slow Sunday morning', 'Blue Keys', 3900, ['0x312e81', '0xfda4af', '0x1e1b4b'], ['SLOW', 'SUNDAY'], { discover: true }),
  V('desertDoc17', 'The desert at night: a nature documentary', 'Blue Planet Lab', 3120, ['0x7c2d12', '0xfcd34d', '0x292524'], ['DESERT', 'NIGHTS'], { discover: true }),
  V('potteryMk18', 'Making a teapot on the wheel, start to finish', 'Clay Hours', 2280, ['0x57534e', '0xfdba74', '0x292524'], ['CLAY', 'TEAPOT'], { discover: true }),
  V('lighthse019', 'Life of a lighthouse keeper', 'Coastlines', 1710, ['0x1e3a8a', '0xfde68a', '0x0f172a'], ['LIGHT', 'HOUSE'], { discover: true }),
]
const byId = Object.fromEntries(videos.map((v) => [v.id, v]))
const playlist = { id: 'PLfocusmusic', title: 'Focus Music', channel: 'Quiet Rooms', ids: ['lofiFocus01', 'rainSounds9', 'focusCafe10', 'jazzPiano07'] }
const captions = [
  'WEBVTT', '',
  '00:00:01.000 --> 00:00:06.000', 'we leave Shinjuku just after midnight',
  '', '00:02:10.000 --> 00:02:16.000', 'the expressway loops around Tokyo Tower',
  '', '00:14:30.000 --> 00:14:36.000', 'Rainbow Bridge lit up over the bay',
  '', '00:31:05.000 --> 00:31:12.000', 'quiet backstreets of Shibuya in the rain',
  '', '00:52:40.000 --> 00:52:46.000', 'sunrise over Odaiba as the drive ends', '',
].join('\n')
writeFileSync(join(WORK, 'catalog.json'), JSON.stringify({ videos, playlist, captions }))

// ---- media: generated thumbnails and a gradient video
const media = join(WORK, 'media')
const thumbs = join(WORK, 'thumbs')
mkdirSync(media, { recursive: true })
mkdirSync(thumbs, { recursive: true })
const textFile = (name, text) => {
  const p = join(WORK, 'txt-' + name + '.txt')
  writeFileSync(p, text)
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:')
}
function art(v, out, w = 1280, h = 720) {
  const [c0, c1, c2] = v.colors
  const size = Math.round(h * 0.2)
  const line1 = textFile(v.id + '1', v.words[0])
  const line2 = textFile(v.id + '2', v.words[1] ?? '')
  const draw = (file, y) => `drawtext=fontfile='${FONT}':textfile='${file}':fontsize=${size}:fontcolor=white:x=${Math.round(w * 0.07)}:y=${y}:shadowx=5:shadowy=5:shadowcolor=black@0.35`
  const vf = [draw(line1, Math.round(h * 0.28)), draw(line2, Math.round(h * 0.28 + size * 1.05))].join(',')
  ff(['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:c2=${c2}:nb_colors=3:seed=${v.id.length * 7}:type=linear`, '-frames:v', '1', '-vf', vf, out])
}
for (const v of videos) art(v, join(thumbs, v.id + '.png'))
const hero = byId.tokyoNight6
const heroText1 = textFile('hero1', 'TOKYO NIGHTS')
ff([
  '-f', 'lavfi', '-i', `gradients=s=1280x720:c0=${hero.colors[0]}:c1=${hero.colors[1]}:c2=${hero.colors[2]}:nb_colors=3:speed=0.02:d=40:type=radial`,
  '-f', 'lavfi', '-i', 'sine=frequency=220:duration=40',
  '-vf', `drawtext=fontfile='${FONT}':textfile='${heroText1}':fontsize=110:fontcolor=white@0.92:x=(w-text_w)/2:y=(h-text_h)/2:shadowx=4:shadowy=4:shadowcolor=black@0.3`,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-af', 'volume=0.05', '-shortest', '-movflags', '+faststart', join(media, 'muxed.mp4'),
])
ff(['-i', join(media, 'muxed.mp4'), '-an', '-c', 'copy', '-movflags', '+faststart', join(media, 'video.mp4')])
ff(['-i', join(media, 'muxed.mp4'), '-vn', '-c', 'copy', join(media, 'audio.m4a')])
copyFileSync(join(HERE, 'fake-ytdlp'), join(WORK, 'fake-ytdlp'))
chmodSync(join(WORK, 'fake-ytdlp'), 0o755)
const fake = fakeYtdlpCommand(join(WORK, 'fake-ytdlp'), WORK)

// ---- library on disk
const dl = join(WORK, 'Videos', 'YTD Studio')
mkdirSync(dl, { recursive: true })
const day = 24 * 3600 * 1000
function addItem(id, folder, index, kind = 'video') {
  const v = byId[id]
  const dir = folder ? join(dl, folder) : dl
  mkdirSync(dir, { recursive: true })
  const base = (index ? String(index).padStart(3, '0') + ' - ' : '') + v.title.replace(/[\\/:*?"<>|]/g, '-') + ' [' + v.id + ']'
  copyFileSync(join(media, 'muxed.mp4'), join(dir, base + (kind === 'audio' ? '.mp3' : '.mp4')))
  copyFileSync(join(thumbs, v.id + '.png'), join(dir, base + '.png'))
  writeFileSync(join(dir, base + '.info.json'), JSON.stringify({ id: v.id, title: v.title, uploader: v.channel, duration: v.duration }))
  if (id === 'tokyoNight6') writeFileSync(join(dir, base + '.en.srt'), '1\n00:00:01,000 --> 00:00:06,000\nWe leave Shinjuku just after midnight.\n')
  return (folder ? folder + '/' : '') + base + (kind === 'audio' ? '.mp3' : '.mp4')
}
const keys = {}
for (const id of ['tinyHouse02', 'blackHole03', 'sourdough04', 'rustCourse5', 'yogaFlow008', 'synthWave11', 'tokyoNight6']) keys[id] = addItem(id)
playlist.ids.forEach((id, i) => (keys[id] = addItem(id, playlist.title, i + 1, 'audio')))

const config = join(WORK, 'config')
const userData = join(config, 'YTD Studio')
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ downloadsDir: dl, ytdlpPath: fake, ffmpegPath: ffmpeg, lastTab: 'home', preferredHeight: 1080, concurrentDownloads: 2, autoSyncHours: 6, theme: 'dark', accent: 'crimson', watchClipboard: false }))
const now = Date.now()
writeFileSync(
  join(userData, 'library-state.json'),
  JSON.stringify({
    favorites: [keys.blackHole03, keys.tokyoNight6, keys.lofiFocus01],
    progress: {
      [keys.rustCourse5]: { position: 2480, duration: 6012, updatedAt: now - 2 * 3600 * 1000, watched: false },
      [keys.blackHole03]: { position: 610, duration: 1122, updatedAt: now - 5 * 3600 * 1000, watched: false },
      [keys.tinyHouse02]: { position: 1934, duration: 1934, updatedAt: now - 3 * day, watched: true },
      [keys.lofiFocus01]: { position: 3100, duration: 7260, updatedAt: now - day, watched: false },
      [keys.tokyoNight6]: { position: 1850, duration: 3611, updatedAt: now - 30 * 60 * 1000, watched: false },
    },
    playlists: [
      { id: 'pl-weekend', name: 'Weekend projects', items: [keys.tinyHouse02, keys.sourdough04, keys.yogaFlow008], createdAt: now - 9 * day },
      { id: 'pl-science', name: 'Science nights', items: [keys.blackHole03, keys.rustCourse5], createdAt: now - 4 * day },
    ],
    saved: [
      { id: playlist.id, url: 'https://www.youtube.com/playlist?list=' + playlist.id, title: playlist.title, folder: playlist.title, mode: 'audio_only', height: null, audioFormat: 'mp3', thumbnail: 'https://i.ytimg.com/vi/lofiFocus01/hqdefault.jpg', knownIds: playlist.ids, lastSync: now - 2 * 3600 * 1000, lastAdded: 1 },
      { id: 'UCcitywalks', url: 'https://www.youtube.com/@citywalks/videos', title: 'City Walks', folder: 'City Walks', mode: 'video_audio', height: 1080, audioFormat: 'mp3', thumbnail: 'https://i.ytimg.com/vi/tokyoNight6/hqdefault.jpg', knownIds: ['tokyoNight6'], lastSync: now - 5 * 3600 * 1000, lastAdded: 0 },
    ],
  }),
)
const job = (id, status, extra = {}) => {
  const v = byId[id]
  return {
    id: 'job-' + id, url: 'https://www.youtube.com/watch?v=' + id, videoId: id, title: v.title, uploader: v.channel,
    thumbnail: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg', duration: v.duration, mode: 'video_audio',
    qualityLabel: 'video + audio · up to 1080p', status, percent: status === 'completed' ? 100 : 0, speed: null, eta: null,
    downloadedBytes: status === 'completed' ? 412e6 : 0, totalBytes: status === 'completed' ? 412e6 : 0, outputPath: null,
    error: null, stage: status === 'completed' ? 'Saved' : 'Waiting in queue', folder: null, playlistIndex: null, logTail: '',
    createdAt: now - 60000, startedAt: null, finishedAt: status === 'completed' ? now - day : null,
    request: { url: 'https://www.youtube.com/watch?v=' + id, mode: 'video_audio', height: 1080 }, ...extra,
  }
}
writeFileSync(
  join(userData, 'jobs.json'),
  JSON.stringify([
    job('oceanDocu12', 'paused', { createdAt: now - 4000 }),
    job('slowTrain13', 'paused', { createdAt: now - 3000, qualityLabel: 'video + audio · up to 1080p · no sponsors', request: { url: 'https://www.youtube.com/watch?v=slowTrain13', mode: 'video_audio', height: 1080, sponsorBlock: true } }),
    job('ambientPn16', 'paused', { createdAt: now - 2000, mode: 'audio_only', qualityLabel: 'mp3 audio', request: { url: 'https://www.youtube.com/watch?v=ambientPn16', mode: 'audio_only', audioFormat: 'mp3' } }),
    job('forestWalk4', 'paused', { createdAt: now - 1000, qualityLabel: 'video + audio · up to 1080p · clip 2:00–6:30', request: { url: 'https://www.youtube.com/watch?v=forestWalk4', mode: 'video_audio', height: 1080, clipStart: 120, clipEnd: 390 } }),
    job('tinyHouse02', 'completed', { createdAt: now - day - 5000 }),
    job('potteryMk18', 'error', { createdAt: now - 2 * day, finishedAt: now - 2 * day, stage: 'Failed', error: 'ERROR: [youtube] potteryMk18: Sign in to confirm your age. This video may be inappropriate for some users.' }),
  ]),
)

// ---- local media host (bounded ranges, like googlevideo)
const server = createServer((req, res) => {
  const path = req.url.split('?')[0]
  let body
  try {
    body = readFileSync(join(media, path))
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '')
  const start = m ? Number(m[1]) : 0
  const end = m && m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1
  res.writeHead(m ? 206 : 200, {
    'Content-Type': path.endsWith('.m4a') ? 'audio/mp4' : path.endsWith('.vtt') ? 'text/vtt' : 'video/mp4',
    'Content-Length': end - start + 1,
    ...(m ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}),
    'Accept-Ranges': 'bytes',
  })
  res.end(body.subarray(start, end + 1))
})
writeFileSync(join(media, 'captions.vtt'), captions)
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const mediaBase = 'http://127.0.0.1:' + server.address().port

// ---- fake Ollama
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function streamChat(res, text) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
  for (const piece of text.match(/[\s\S]{1,40}/g) ?? []) {
    res.write(JSON.stringify({ message: { role: 'assistant', content: piece }, done: false }) + '\n')
    await sleep(5)
  }
  res.end(JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }) + '\n')
}
const REASONS = [
  'Slow, beautifully shot and narrated in a calm voice: exactly the unhurried documentary you asked for.',
  'Pure slow TV: hours of fjords with no talking, ideal to keep on in the background.',
  'A gentle, quiet walk with natural sound only; no music or chatter.',
  'Relaxed and informative, short enough for a lazy morning.',
  'Soft ambient piano that matches a slow Sunday mood.',
  'A calm nature documentary with stunning night footage.',
  'Meditative craft video; viewers call it oddly relaxing.',
  'Quiet, thoughtful story told at an easy pace.',
]
const ollama = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const body = raw ? JSON.parse(raw) : null
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ models: [{ name: 'gpt-oss:120b', details: { parameter_size: '116.8B' } }, { name: 'gpt-oss:20b', size: 13e9, details: { parameter_size: '20.9B' } }] }))
      return
    }
    const props = body?.format?.properties ?? {}
    const user = (body?.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content).join('\n')
    const system = (body?.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content).join('\n')
    if (props.queries) {
      return streamChat(res, JSON.stringify({ intent: 'Calm, slow documentaries and gentle music for an unhurried Sunday, nothing loud or clickbaity.', queries: [{ q: 'slow tv nature documentary', sort: 'relevance' }, { q: 'calm ambient piano sunday', sort: 'views' }, { q: 'relaxing documentary narrated', sort: 'date' }], recency: 'any', minMinutes: 15, maxMinutes: 0, allowShorts: false }))
    }
    if (props.picks) {
      const n = user.split('\n').filter((l) => /^\d+\. /.test(l)).length
      const picks = Array.from({ length: n }, (_, k) => ({ i: k + 1, score: 97 - k * 5, why: REASONS[k % REASONS.length] }))
      return streamChat(res, JSON.stringify({ picks }))
    }
    if (props.groups) return streamChat(res, JSON.stringify({ groups: [{ name: 'Chill & focus', description: 'Music and ambience to work to', items: [1, 2, 3] }] }))
    if (/TL;DW/.test(system)) {
      return streamChat(
        res,
        '## TL;DW\nAn hour-long, **dialogue-free night drive** across central Tokyo, filmed in 4K from the dashboard, with ambient city sound. Perfect background for focus or winding down.\n\n## Key moments\n- [02:10] Expressway loop around **Tokyo Tower**\n- [14:30] Crossing the Rainbow Bridge over the bay\n- [31:05] Rainy backstreets of Shibuya\n- [52:40] Sunrise over Odaiba\n\n## Worth watching?\nYes, if you like slow, atmospheric video. Skip it if you want commentary.',
      )
    }
    if (/answer questions about one YouTube video/.test(system)) return streamChat(res, 'The Rainbow Bridge section starts at [14:30] and lasts about four minutes.')
    return streamChat(res, 'YTD Studio is connected.')
  })
})
await new Promise((resolve) => ollama.listen(0, '127.0.0.1', resolve))
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')), aiHost: 'http://127.0.0.1:' + ollama.address().port, aiModel: 'gpt-oss:120b' }))

// ---- run the app
const env = { ...process.env, YTD_USER_DATA: userData, XDG_CONFIG_HOME: config, APPDATA: config, FAKE_MEDIA_BASE: mediaBase, FAKE_STEP: '0.6' }
delete env.ELECTRON_RUN_AS_NODE
delete env.OLLAMA_API_KEY
const app = await _electron.launch({ executablePath: electronPath, args: ['--no-sandbox', '--force-device-scale-factor=1', REPO], cwd: REPO, env })
let failed = false
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30000 })
  const win = await app.browserWindow(page)
  await win.evaluate((w) => {
    w.setSize(1480, 940)
    w.center()
  })
  // Every thumbnail (proxied or direct) is served from the generated art.
  await page.route(/(\/img\?u=|i\.ytimg\.com)/, async (route) => {
    const url = decodeURIComponent(route.request().url())
    const id = /\/vi\/([^/]+)\//.exec(url)?.[1]
    const file = id ? join(thumbs, id + '.png') : null
    if (file && existsSync(file)) await route.fulfill({ path: file, contentType: 'image/png' })
    else await route.fulfill({ status: 404, body: '' })
  })
  const shot = async (name) => {
    await page.waitForTimeout(700)
    await page.screenshot({ path: join(OUT, name + '.png') })
    console.log('saved', name)
  }
  const nav = (label) => page.click(`button.nav-item:has-text("${label}")`)
  // Remembered streams for Home and Stream.
  await page.evaluate((list) => localStorage.setItem('stream.history', JSON.stringify(list)), ['synthWave11', 'jazzPiano07', 'starGazin15', 'lighthse019', 'desertDoc17'].map((id, i) => ({ url: 'https://www.youtube.com/watch?v=' + id, videoId: id, title: byId[id].title, uploader: byId[id].channel, duration: byId[id].duration, at: now - (i + 1) * 3 * 3600 * 1000 })))
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30000 })

  // Downloads running in the background for Home / Download.
  await page.evaluate(() => window.api.resumeAll())
  await page.waitForTimeout(9000)

  // Home with a link pasted
  await nav('Home')
  await page.fill('.link-bar input', 'https://www.youtube.com/watch?v=tokyoNight6')
  await page.click('.link-bar button[type="submit"]')
  await page.waitForSelector('.quick-card h3', { timeout: 20000 })
  await page.waitForTimeout(1200)
  await shot('home')

  // Download: an analyzed video with quality cards, plus the live queue
  await nav('Download')
  await page.fill('input[placeholder^="https://www.youtube.com/watch?v=... or"]', 'https://www.youtube.com/watch?v=tokyoNight6')
  await page.click('button:has-text("Analyze")')
  await page.waitForSelector('[data-tab="download"] .q-card', { timeout: 20000 })
  await page.click('[data-tab="download"] details.more summary')
  await page.fill('input[aria-label="Clip start"]', '2:10')
  await page.fill('input[aria-label="Clip end"]', '14:30')
  await shot('download')
  await page.evaluate(() => document.querySelector('[data-tab="download"] .panel-scroll').scrollTo(0, 99999))
  await shot('queue')

  // Library
  await nav('Library')
  await page.waitForSelector('.lib-card', { timeout: 10000 })
  await shot('library')

  // Player
  await page.locator('.lib-card:has-text("Synthwave")').locator('button:has-text("Play")').click()
  await page.waitForSelector('.overlay video', { timeout: 10000 })
  await page.evaluate(async () => {
    const v = document.querySelector('.overlay video')
    v.muted = true
    await new Promise((r) => setTimeout(r, 1500))
    v.currentTime = 6
    v.pause()
    const track = v.textTracks[0]
    if (track) track.mode = 'showing'
  })
  await page.click('.overlay button:has-text("Shortcuts")')
  await shot('player')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Playlists
  await nav('Playlists')
  await page.click('.pl-item:has-text("Focus Music")')
  await page.waitForSelector('.pl-row', { timeout: 5000 })
  await shot('playlists')

  // Stream with AI insights
  await nav('Stream')
  await page.fill('input[placeholder="https://www.youtube.com/watch?v=..."]', 'https://www.youtube.com/watch?v=tokyoNight6')
  await page.click('[data-tab="stream"] button:has-text("Play")')
  await page.waitForSelector('[data-tab="stream"] .video-frame video', { timeout: 20000 })
  await page.evaluate(async () => {
    const v = document.querySelector('[data-tab="stream"] .video-frame video')
    v.muted = true
    await new Promise((r) => setTimeout(r, 1500))
    v.currentTime = 12
    v.pause()
  })
  await page.click('[data-tab="stream"] .ai-card button:has-text("Summarize")')
  await page.waitForSelector('[data-tab="stream"] .ai-summary .stamp', { timeout: 20000 })
  await page.waitForTimeout(800)
  await page.evaluate(() => document.querySelector('[data-tab="stream"] .panel-scroll').scrollTo(0, 260))
  await shot('stream')

  // Discover
  await nav('Discover')
  await page.fill('.discover-input', 'relaxing documentaries and calm music for a slow Sunday, nothing loud')
  await page.click('button:has-text("Find videos")')
  await page.waitForSelector('.disc-card', { timeout: 30000 })
  await page.waitForTimeout(1200)
  await shot('discover')

  // Command palette
  await nav('Library')
  await page.keyboard.press('Control+k')
  await shot('palette')
  await page.keyboard.press('Escape')

  // Settings
  await nav('Settings')
  await shot('settings')

  // Light theme with another accent
  await page.evaluate(() => window.api.updateSettings({ theme: 'light', accent: 'ocean' }))
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30000 })
  await nav('Home')
  await page.waitForTimeout(1500)
  await shot('home-light')
  await page.evaluate(() => window.api.updateSettings({ theme: 'dark', accent: 'crimson' }))
} catch (err) {
  failed = true
  console.error(err)
} finally {
  await app.close().catch(() => undefined)
  server.close()
  ollama.close()
  if (!failed) rmSync(WORK, { recursive: true, force: true })
  else console.log('work dir kept for inspection:', WORK)
  process.exit(failed ? 1 : 0)
}
