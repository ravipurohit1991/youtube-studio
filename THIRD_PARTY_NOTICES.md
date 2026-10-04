# Third-party notices

## Tools downloaded at runtime (not distributed with this project)

YTD Studio does not include, bundle or redistribute these programs. On first run the app downloads
them from their official sources onto the user's own machine (`%APPDATA%/YTD Studio/bin`) and runs
them as separate processes.

| Tool | Source | License |
| --- | --- | --- |
| yt-dlp | https://github.com/yt-dlp/yt-dlp (GitHub releases) | The Unlicense |
| FFmpeg / ffprobe | https://www.gyan.dev/ffmpeg/builds/ (fallback: https://github.com/yt-dlp/FFmpeg-Builds) | GPL v3 build of FFmpeg; license text is saved next to the binaries as `ffmpeg-LICENSE.txt` |

FFmpeg source code is available from https://ffmpeg.org and the build providers above.

## Packaged dependencies

The installer contains Electron (MIT, with Chromium and its bundled `ffmpeg.dll` codec library under
their own licenses, see `LICENSES.chromium.html` in the installed app), React (MIT) and lucide-react (ISC).

## Android app (bundled in the APK)

Unlike the desktop app, the Android APK includes these components, because Android does not allow
apps to run executables downloaded at runtime:

| Component | Source | License |
| --- | --- | --- |
| youtubedl-android (library, ffmpeg module) | https://github.com/JunkFood02/youtubedl-android (fork of https://github.com/yausername/youtubedl-android) | GPL-3.0 |
| yt-dlp (initial copy; replaced by the latest GitHub release at runtime) | https://github.com/yt-dlp/yt-dlp | The Unlicense |
| CPython (Termux build) | https://github.com/termux/termux-packages | PSF License |
| FFmpeg / ffprobe (Termux build) | https://ffmpeg.org, https://github.com/termux/termux-packages | GPL (FFmpeg built with GPL components) |
| QuickJS | https://bellard.org/quickjs/ | MIT |
| AndroidX, Jetpack Compose, Media3 (ExoPlayer) | https://developer.android.com/jetpack | Apache 2.0 |
| Kotlin standard library, kotlinx.coroutines | https://kotlinlang.org | Apache 2.0 |
| Jackson, Apache Commons IO / Compress (via youtubedl-android) | https://github.com/FasterXML/jackson, https://commons.apache.org | Apache 2.0 |

Because the APK combines GPL-3.0 components, the APK as distributed is covered by GPL-3.0. The
complete corresponding source for this app is this repository; sources for the bundled components
are at the links above. YTD Studio's own code remains MIT licensed (MIT is GPL-compatible).
