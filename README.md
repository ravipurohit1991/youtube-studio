# YTD Studio

A lightweight Windows desktop app (Electron + TypeScript + React), plus an [Android app](#android-app)
with the same features, for four jobs, plus an optional [AI layer](#ai-discover-summaries-and-smart-playlists-ollama) in both apps:

1. **Stream**: paste a YouTube link and watch it inside the app. No ads, no popups, and seeking works properly.
2. **Download**: two modes only. The **whole video (with audio)** as MP4, or **audio only** (MP3/M4A/OPUS/WAV/FLAC).
   **Whole playlists in one click**, each in its own folder in playlist order, optionally **kept in sync**
   (Sync later downloads only the videos added since). Batch links too, with a live queue.
3. **Watch**: a player with an up-next queue, autoplay, shuffle, repeat, playback speed and keyboard shortcuts.
   It **remembers where you stopped** in every video and offers it under *Continue watching*.
4. **Organize**: a Library with favorites, watched/unwatched, search and sorting, a **Playlists** tab with your
   downloaded YouTube playlists, and **playlists of your own** (create, rename, reorder, play all, shuffle).

Plus a **Settings** tab for the downloads folder, quality defaults, and the tools behind the scenes.

With an [Ollama](https://ollama.com) model connected (Ollama Cloud with your API key, or a local Ollama):

5. **Discover**: your own YouTube algorithm. Describe what you want in plain words; the model plans the
   searches, the app runs them, and the model ranks every result for *you*, with a reason for each pick.
   Refine it conversationally, give thumbs up/down, hide channels, or let **For you** work from your library.
6. **AI insights**: a streamed *TL;DW* summary of any video from its captions, with **clickable key
   moments** that jump the player there, and a chat to ask questions about the video.
7. **Smart playlists**: the model sorts your library into themed playlists; you pick which ones to create.

---

## Download the builds

GitHub Actions builds both apps on every push (`.github/workflows/build.yml`):

1. Open the repository's **Actions** tab and pick the latest **Build** run.
2. Under **Artifacts**, download **YTD-Studio-Windows** (the `...-setup.exe` installer) and/or
   **YTD-Studio-Android** (the APKs).

Pushing a tag such as `v1.0.1` also creates a **GitHub Release** with both attached, which is easier
to open on a phone (no sign-in or zip file).

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

## AI: Discover, summaries and smart playlists (Ollama)

Everything AI is optional and off until you connect a model. It works the same on the desktop and on
Android (see [Android: AI](#android-ai) for the differences). Open **Settings > AI (Ollama)**:

1. **Server**: *Ollama Cloud* (`https://ollama.com`, the default) or *Local Ollama* (`http://localhost:11434`).
2. **API key** (needed for the cloud): create one at [ollama.com/settings/keys](https://ollama.com/settings/keys)
   and paste it. It is stored encrypted with your OS keychain (Electron `safeStorage`; Windows DPAPI) in
   `ai-key.json`, stays in the main process (the UI only learns "a key ending in ...7f3a is saved"), and is
   only sent to your AI server (HTTPS or this machine, never plain HTTP to another machine) and to Ollama
   web search. The `OLLAMA_API_KEY` environment variable works too.
3. **Model**: picked from the server's list (`/api/tags`). A strong default is chosen for you; **Test**
   sends one tiny prompt. Bigger models rank and summarize better, smaller ones answer faster.

### Discover: your own recommendation algorithm

YouTube's recommendations optimize for watch time. Discover optimizes for what you asked:

```text
"honest reviews of budget mechanical keyboards, no unboxings"
   │
   ├─ taste profile (optional) ── channels you download most, favorites, finished videos,
   │                              thumbs up/down, hidden channels, recent requests
   ├─ web lookup (optional) ───── Ollama web search, for new releases and current events
   ▼
 PLAN   the model writes 3-6 diverse searches, each with a sort (relevance / upload date / views),
        plus length bounds and whether Shorts make sense
   ▼
 SEARCH yt-dlp runs them as real YouTube results pages with YouTube's own filters
        (videos only, upload date, duration, sort), 3 at a time
   ▼
 FILTER drop duplicates, Shorts, live streams, channels you hid, videos you disliked and
        videos you already downloaded
   ▼
 RANK   the model scores every candidate 0-100 for this request and your taste, penalizing
        clickbait, reuploads and off-topic results, and says why each pick fits
```

- **Refine** ("shorter", "more advanced", "no talking heads") keeps the original request and stacks
  follow-ups; **Undo** drops the last one. **More** fetches new videos without repeats.
- **Thumbs up / down** and **Never show this channel** are remembered (`ai-taste.json`) and shape every
  later ranking. *Your taste* lists them and forgets any item with one click.
- Length and upload-date filters in the bar apply to every search; **Personalize** and **Check the web
  first** are remembered in Settings.
- Results play in the Stream tab, download as video or audio (one or many), or open an AI summary first.

### AI insights on any video

The Stream tab (and the summary button on Discover results) reads the video's captions through yt-dlp:
uploaded English subtitles first, then the captions in the language spoken, then anything available.
YouTube's rolling automatic captions are de-duplicated and compacted into `[mm:ss]` lines (long videos are
thinned evenly so the transcript stays around 12k tokens). The summary streams in as *TL;DW*, *Key moments*
and *Worth watching?*; every `[mm:ss]` is a button that seeks the player. Questions are answered from the
same transcript, with timestamps. Videos without captions fall back to the description and chapters.

### Smart playlists

**Playlists > Smart playlists (AI)** sends titles, channels and lengths of up to 300 library items, gets back
3-10 themed groups, and shows them for review. Nothing is created until you click **Create**.

### What is sent where

Only when you use an AI feature: your request; titles, channels, lengths and view counts of search
results; (with Personalize) titles and channels from your library and your feedback; and the captions of
videos you summarize or ask about. All of it goes to the server in Settings; web lookups go to Ollama web
search. Nothing is sent in the background.

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
    library-state.ts favorites, watch progress, your playlists and synced YouTube playlists (library-state.json)
    settings.ts      JSON-backed settings store
    ai/
      ollama.ts        Ollama client (streamed chat, structured JSON, models, web search), encrypted API key
      discover.ts      plan searches, YouTube filter encoding, search, filter, rank
      transcript.ts    caption track choice, WebVTT parsing, timestamped transcript for prompts
      insights.ts      summaries, questions about a video, smart playlists
      taste.ts         thumbs up/down, hidden channels, recent requests (ai-taste.json)
  preload/         contextBridge API exposed as window.api
  renderer/        React UI (Discover / Stream / Download / Library / Playlists / Settings, player overlay)
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

YouTube also needs a JavaScript runtime for yt-dlp to see the full format list (without one it
falls back to a limited client whose formats are mostly HLS, which `<video>` cannot play). Electron
already contains Node, so the app passes `--js-runtimes node:<its own executable>` and runs that in
plain-Node mode (`ELECTRON_RUN_AS_NODE=1`); nothing extra to install. The proxy only offers plain
HTTPS formats to the player and reads googlevideo in bounded 10 MB ranges with the headers yt-dlp
reports, the same way yt-dlp downloads them.

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
| A playlist only queues some videos | Use **Download whole playlist**, or tick the videos you want and use **Download N selected**. Up to 2000 entries are read. |
| A synced playlist re-downloads nothing new | Sync only fetches videos that were not in the playlist when it was saved or last synced. Videos you unticked then are skipped on purpose. |
| Port 47821 busy | The app automatically falls back to a random free port. |
| AI: "rejected the request (401)" | The API key is wrong or revoked. Settings > AI > **Replace** and paste a new one. |
| AI: "usage limit reached (429)" | Your Ollama plan's limit for now. Wait, or pick a smaller model. |
| AI: "model ... is not available" | The model was removed or renamed. Settings > AI > **Refresh list** and pick another. |
| AI summary says there is no transcript | The video has no captions; the summary is based on the description and chapters only. |
| Discover results feel generic | Turn on **Personalize**, give a few thumbs up/down, or use a bigger model. |

Logs live in `%APPDATA%/YTD Studio/app.log`; the downloaded yt-dlp and ffmpeg live in `%APPDATA%/YTD Studio/bin`.

---

## Android app

`android/` is a native Kotlin + Jetpack Compose (Material 3) app with the same idea: paste a link (or
**Share** a video from the YouTube app to *YTD Studio*), then watch it right away or download it, and
watch and organize everything offline.

| Tab | What it does |
| --- | --- |
| Home | One link bar: paste (or share) a video or playlist and a sheet offers **Watch now**, **Listen** (audio only) or **Download** (a whole playlist in one tap, optionally kept in sync). Below: *Continue watching*, *Recently added*, your playlists and favorites. |
| Library | Videos (grid or list), Music, Playlists and Favorites tabs, with search, sorting, play all and shuffle. Every item has favorite, add to playlist, mark (un)watched, share, open with and delete. Playlists: downloaded YouTube playlists (in order, with Sync) and your own (create, rename, reorder, remove). |
| Downloads | Live queue with progress and stages ("Downloading video", "Merging video and audio", "Saving..."), history and retry, and your synced playlists with **Sync** / **Sync all**. Downloads keep running in the background with a progress notification. |
| Discover | The [AI Discover](#discover-your-own-recommendation-algorithm) feed: describe what you want (or tap **For you**), get ranked videos with reasons, refine, thumbs up/down, hide channels, then Play, Summary or Download. |
| Settings | **AI (Ollama)**: server, API key, model, test. Theme (system / light / dark, Material You colors), playback (resume, picture-in-picture, background play for videos), download defaults, playlist folders, yt-dlp version and updates. |

The player runs as a media session: music keeps playing in the background with lock-screen and
notification controls, videos shrink to **picture-in-picture** when you leave, and the queue has
next/previous, shuffle, repeat and playback speed. It resumes every file where you left off.

Files are saved through Android's MediaStore into **Movies/YTD Studio** (video) and
**Music/YTD Studio** (audio), playlists in a subfolder each, so they show up in Gallery and music
players and stay on the phone even if the app is uninstalled. No storage permission is needed.
Android 10 or newer.

### Android: AI

The same Discover, insights and smart playlists as the desktop app, in Kotlin (`ai/`): same prompts,
same YouTube search filters, same ranking and feedback. Differences:

- **API key**: encrypted with an AES key held in the **Android Keystore** (hardware-backed on most
  phones, never exportable); only the ciphertext is stored, and backups are off.
- **AI insights** live in the player: tap the sparkle button while a stream or a downloaded YouTube video
  plays, and the key moments in the summary seek the player. Discover's **Summary** opens the same sheet
  before you watch.
- **Smart playlists**: Library > Playlists > **Smart playlists**.
- **Your own server** works too: set the server to your computer's address, e.g. `http://192.168.1.20:11434`
  (start Ollama with `OLLAMA_HOST=0.0.0.0` so the phone can reach it). Plain HTTP is allowed for this;
  the API key is never sent over plain HTTP to another machine.

### Does Android need yt-dlp and ffmpeg? Yes, and they are inside the APK

- **ffmpeg is required.** YouTube serves anything above 360p as a separate video stream and audio
  stream; ffmpeg joins them into one MP4. It also converts audio to MP3 and embeds cover art.
- **yt-dlp is required** to read YouTube at all, and it is a Python program.
- **A JavaScript runtime is required** by current yt-dlp to solve YouTube's player challenges.

The desktop app downloads `yt-dlp.exe` and `ffmpeg.exe` on first run. Android cannot do that: apps
may not execute files they downloaded into their own storage (since Android 10). The app therefore
uses [youtubedl-android](https://github.com/JunkFood02/youtubedl-android) (the library behind
apps like Seal), which ships **CPython, ffmpeg/ffprobe and QuickJS as native libraries** (`lib*.so`)
inside the APK. Android installs those into the app's native library folder, which is allowed to
execute, and the app unpacks the Python standard library and ffmpeg's shared libraries into its
private storage on first launch (a few seconds, once).

yt-dlp itself is just a Python zip file that this Python runs. That is what allows the app to keep
it current: on launch (at most every 12 hours) and from **Settings > Check for update now** it
fetches the newest release from yt-dlp's GitHub, exactly like the desktop app does.

Because those binaries are per-CPU, the build produces one APK per CPU type (about 100 MB each):

| APK | For |
| --- | --- |
| `YTD-Studio-<version>-arm64-v8a-release.apk` | Practically every phone from the last 8 years. **Use this one.** |
| `YTD-Studio-<version>-armeabi-v7a-release.apk` | Old 32-bit phones |
| `YTD-Studio-<version>-x86_64-release.apk` | The Android emulator / Chromebooks |

### Installing on your phone

Download the APK on the phone (or copy it over), open it, and allow "install unknown apps" for your
browser or file manager when Android asks.

**Updates install over the old version only if both are signed with the same key.** Without
configuration, each CI build is signed with a fresh debug key, so you would have to uninstall
before installing a newer build. To keep one key, create a keystore once and add it as repository
secrets (Settings > Secrets and variables > Actions):

```bash
keytool -genkeypair -v -keystore ytd-release.jks -alias ytd -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 ytd-release.jks   # copy the output
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text from above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `ytd` |
| `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password if you did not set one) |

Keep `ytd-release.jks` somewhere safe and never commit it. Every build is numbered with the CI run
number, so newer builds always install as updates.

### Building the APK locally

Needs JDK 17 and the Android SDK (Android Studio installs both):

```bash
cd android
./gradlew assembleRelease     # APKs in android/app/build/outputs/apk/release/
```

### Android layout

```text
android/app/src/main/java/com/ytdstudio/android/
  engine/Engine.kt          yt-dlp: init, self-update, probe, download (progress + stages), stream URLs,
                            YouTube search pages and caption downloads for the AI features
  ai/                       Ollama client (streamed chat, structured JSON, web search), Keystore-encrypted
                            key, Discover (plan, search, filter, rank), insights from captions, smart
                            playlists, taste profile
  service/DownloadService   foreground service running the queue, progress notification, wake lock
  service/PlaybackService   Media3 session: background playback, media notification, watch progress
  data/                     job queue + history, library state (favorites, progress, playlists, synced
                            playlists), settings, MediaStore save/list per playlist folder (MediaLibrary)
  ui/                       Compose screens (Home, Discover, Library, Downloads, Settings, link sheet), player
                            screen with picture-in-picture, stream sources (10 MB chunked reads)
```

---

## Desktop end-to-end test (no YouTube needed)

`pnpm build && pnpm test:e2e` (Linux: wrap it in `xvfb-run -a`) launches the real app with a
stand-in yt-dlp (`scripts/e2e/fake-ytdlp`) and a fake media host, and checks the queue, live
progress and stages, history, library grouping, in-app streaming, whole-playlist downloads into a
folder and Sync, favorites, your own playlists and resume. A fake Ollama server covers the AI features:
key handling, model pick, Discover's plan/search/filter/rank and feedback, streamed summaries with seeking
key moments, questions, and smart playlists. CI runs it on every push.
Needs `python3` and `ffmpeg`.

---

## Licensing

YTD Studio's own code is MIT licensed (see [LICENSE](LICENSE)). It does not redistribute any third-party
downloader or media tool: [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense) and
[FFmpeg](https://ffmpeg.org) (the downloaded build is GPL v3) are fetched onto the user's machine at
runtime and run as separate programs. The **Android APK is different**: it bundles yt-dlp, CPython,
FFmpeg and QuickJS through youtubedl-android (GPL-3.0), so the APK as a whole is distributed under
GPL-3.0 terms; its source is this repository. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Use this app only for content you have the right to download.
