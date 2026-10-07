/** What a fix button next to an error does. */
export type ErrorFix = 'update-ytdlp' | 'cookies' | 'install-ffmpeg' | 'retry' | 'network'

export interface ErrorHelp {
  /** Short, human headline. */
  title: string
  /** What to do about it. */
  hint: string
  fix: ErrorFix | null
}

const RULES: Array<{ test: RegExp; help: ErrorHelp }> = [
  {
    test: /sign in to confirm (your age|you.?re not a bot)|age[- ]restricted|inappropriate for some users/i,
    help: { title: 'YouTube wants you to sign in', hint: 'Pick your browser under Settings > Network and access > Browser cookies, then retry.', fix: 'cookies' },
  },
  {
    test: /private video|members[- ]only|join this channel/i,
    help: { title: 'This video is private or members-only', hint: 'If your account can watch it, use Browser cookies in Settings so yt-dlp can sign in as you.', fix: 'cookies' },
  },
  {
    test: /video unavailable|has been removed|no longer available|account associated with this video has been terminated/i,
    help: { title: 'The video is gone', hint: 'It was removed, made private or is blocked where you are.', fix: null },
  },
  {
    test: /not available in your country|geo.?restrict|blocked it in your country/i,
    help: { title: 'Blocked in your country', hint: 'A proxy in a country where it is available (Settings > Network) can help.', fix: null },
  },
  {
    test: /needs ffmpeg|ffmpeg (is )?not (found|installed)|ffprobe/i,
    help: { title: 'ffmpeg is needed for this', hint: 'Install ffmpeg (one click) to join video and audio, cut clips and convert audio.', fix: 'install-ffmpeg' },
  },
  {
    test: /http error 403|forbidden|unable to extract|nsig|signature|player response|precondition|po token|sabr/i,
    help: { title: 'YouTube changed something', hint: 'This is almost always fixed by updating yt-dlp. Update, then retry.', fix: 'update-ytdlp' },
  },
  {
    test: /http error 429|too many requests|rate.?limit/i,
    help: { title: 'YouTube is rate limiting you', hint: 'Wait a few minutes, download fewer videos at once, or use Browser cookies.', fix: 'retry' },
  },
  {
    test: /getaddrinfo|timed out|timeout|connection (reset|refused|aborted)|network is unreachable|unable to download webpage|temporary failure/i,
    help: { title: 'Network problem', hint: 'Check your connection (or the proxy in Settings) and retry.', fix: 'network' },
  },
  {
    test: /no space left|disk full|errno 28/i,
    help: { title: 'The disk is full', hint: 'Free some space or pick another downloads folder in Settings.', fix: null },
  },
  {
    test: /requested format is not available|format is not available/i,
    help: { title: 'That quality is not offered', hint: 'Pick "Best available" or a lower resolution and retry.', fix: 'retry' },
  },
  {
    test: /interrupted when the app closed/i,
    help: { title: 'Interrupted', hint: 'The app closed while it was downloading. Retry continues where it stopped.', fix: 'retry' },
  },
]

/** Turn a raw yt-dlp error into a headline and a next step; null when nothing specific matches. */
export function explainError(message: string | null | undefined): ErrorHelp | null {
  if (!message) return null
  for (const rule of RULES) if (rule.test.test(message)) return rule.help
  return null
}
