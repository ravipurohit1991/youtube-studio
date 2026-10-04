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
