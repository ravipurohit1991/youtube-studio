# YTD Studio

A lightweight Windows desktop app (Electron + TypeScript + React) for three jobs:

1. **Stream**: paste a YouTube link and watch it inside the app. No ads, no popups, and seeking works properly.
2. **Download**: two modes only. The **whole video (with audio)** as MP4, or **audio only** (MP3/M4A/OPUS/WAV/FLAC). Playlists and batch links are supported, with a live queue.
3. **Library**: browse everything in your downloads folder as a grid with thumbnails, search it, play it in-app, or open it in your default player.

Plus a **Settings** tab for the downloads folder, quality defaults, and the tools behind the scenes.

---

## Quick start

```powershell
pnpm install
pnpm dev          # development window with hot reload
```

```powershell
pnpm build        # compile main / preload / renderer into out/
pnpm start        # run the compiled app
pnpm dist         # NSIS installer in release/
pnpm dist:dir     # unpacked app in release/win-unpacked/
pnpm typecheck    # tsc for the node and web projects
```

---

## First run

**yt-dlp and ffmpeg are not part of this repository or the installer.** Both are downloaded by the app
itself the first time it starts, into `%APPDATA%/YTD Studio/bin`, and that copy is used from then on:

- **yt-dlp**: the newest `yt-dlp.exe` from the official GitHub release.
- **ffmpeg + ffprobe**: the Windows release build from gyan.dev (about 115 MB; falls back to
  yt-dlp's FFmpeg-Builds on GitHub). Only `ffmpeg.exe`, `ffprobe.exe` and the license text are
  extracted. They are only needed to join separate video and audio streams (1080p and up) and to
  convert audio to MP3/WAV/FLAC/OPUS.

Progress shows in the top bar. If a download fails (offline, proxy, blocked), the app keeps working
in a reduced mode and a banner offers **Install yt-dlp** / **Install ffmpeg** to retry. You can also
point the app at your own copies in Settings > Tools (a custom path wins over the managed copy, and
a managed copy wins over anything on PATH).

Without ffmpeg the app still works in a reduced mode: video downloads use the lower-quality
single-file formats YouTube offers (some videos have none), and audio is saved as M4A.

### Keeping yt-dlp current

YouTube changes constantly, so an out-of-date yt-dlp is the most common cause of failures. The app:

- checks GitHub for the latest release on every launch (silently, cached for 30 minutes),
- shows a **yt-dlp available** button in the top bar when you are behind,
- offers **Check for updates** / **Update** buttons in Settings.

---

## How it works

```text
src/
  main/            Electron main process (Node)
    index.ts         window creation, single-instance lock, bootstrap
    ipc.ts           typed IPC surface (every call returns { ok, data | error })
    ytdlp.ts         binary discovery, auto-install, update checks, probing, format selection
    ffmpeg.ts        ffmpeg discovery (settings, managed copy, PATH, winget/choco/scoop), auto-install, version
    stream.ts        turns a video into playable stream URLs (video-only + audio-only)
    media-server.ts  localhost HTTP server: proxies YouTube media with Range support,
                     serves files from the downloads folder, proxies thumbnails
    downloads.ts     queue, concurrency, live progress parsing, history persistence
    library.ts       scans the downloads folder and pairs sidecar thumbnails/metadata
    settings.ts      JSON-backed settings store
  preload/         contextBridge API exposed as window.api
  renderer/        React UI (Stream / Download / Library / Settings)
  shared/          types and IPC channel names used by both sides
scripts/smoke.mjs  end-to-end UI test driven over the Chrome DevTools Protocol
```

### Download modes

| Mode | With ffmpeg | Without ffmpeg |
| --- | --- | --- |
| Video (with audio) | Best video up to your chosen resolution (H.264 preferred) plus best audio, merged into MP4 | Best single-file format with both video and audio |
| Audio only | Converted to MP3 / M4A / OPUS / WAV / FLAC | Saved as M4A, unconverted |

### Streaming

A browser `<video>` element cannot play a YouTube watch page, and pointing it straight at a
googlevideo URL breaks on expiry, missing headers, and seeking. So the main process runs a small
HTTP server on `127.0.0.1:47821` that resolves the requested quality through yt-dlp, streams the
bytes through with the right headers (forwarding `Range` so scrubbing works), re-resolves expired
URLs automatically, serves your downloaded files, and proxies thumbnails.

High resolutions have no single muxed stream, so the app plays the video-only and audio-only
streams together: the visible video element (with the normal player controls) is the clock, and a
hidden audio element follows it (about 0.3s tolerance). Volume and mute are mirrored to the audio.

### Security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer never touches the
filesystem or spawns processes; it only calls the whitelisted preload API. The media server binds to
loopback, only serves files under your downloads folder, and only proxies images from YouTube hosts.
External links open in your real browser.

---

## End-to-end smoke test

`scripts/smoke.mjs` drives the real app over the DevTools Protocol: shell, Settings tab, a live
stream, a real audio download, and the Library listing.

```powershell
# Note: if ELECTRON_RUN_AS_NODE is set in your shell (VS Code does this), clear it first.
Start-Process -FilePath "node_modules/electron/dist/electron.exe" -ArgumentList ".", "--remote-debugging-port=9222"
node scripts/smoke.mjs
```

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "yt-dlp is not installed" | Settings > **Install yt-dlp** (or the button in the top bar). |
| Downloads suddenly fail with an extractor error | Settings > **Check for updates**. YouTube changed something. |
| Video download says it needs ffmpeg, or audio is M4A instead of MP3 | Click **Install ffmpeg** (banner or Settings > Tools). |
| Stream shows video but it is capped at 360p/720p | Normal for some videos; downloads still get full quality (with ffmpeg). |
| Age-restricted or private video fails | Settings > **Browser cookies** > pick your browser. |
| A playlist only queues some videos | Playlists longer than 25 items start with 10 selected. Tick what you want. |
| Port 47821 busy | The app automatically falls back to a random free port. |

Logs live in `%APPDATA%/YTD Studio/app.log`; the downloaded yt-dlp and ffmpeg live in `%APPDATA%/YTD Studio/bin`.

---

## Licensing

YTD Studio's own code is MIT licensed (see [LICENSE](LICENSE)). It does not redistribute any third-party
downloader or media tool: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) and
[FFmpeg](https://ffmpeg.org) (the downloaded build is GPL v3) are fetched onto the user's machine at
runtime and run as separate programs. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Use this app only for content you have the right to download.
