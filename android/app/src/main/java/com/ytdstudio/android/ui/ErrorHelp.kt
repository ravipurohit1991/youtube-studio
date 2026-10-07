package com.ytdstudio.android.ui

/** What the button next to an explained error does. */
enum class ErrorFix { UPDATE_YTDLP, RETRY }

/** A raw yt-dlp error turned into a headline and a next step (same rules as the desktop app). */
data class ErrorHelp(val title: String, val hint: String, val fix: ErrorFix?)

private val RULES: List<Pair<Regex, ErrorHelp>> = listOf(
    Regex("sign in to confirm (your age|you.?re not a bot)|age[- ]restricted|inappropriate for some users", RegexOption.IGNORE_CASE) to
        ErrorHelp("YouTube wants you to sign in", "Age-restricted videos need a signed-in account. The desktop app can use your browser's sign-in for these.", null),
    Regex("private video|members[- ]only|join this channel", RegexOption.IGNORE_CASE) to
        ErrorHelp("Private or members-only", "Only accounts with access can get this video.", null),
    Regex("video unavailable|has been removed|no longer available|account associated with this video has been terminated", RegexOption.IGNORE_CASE) to
        ErrorHelp("The video is gone", "It was removed, made private or is blocked where you are.", null),
    Regex("not available in your country|geo.?restrict|blocked it in your country", RegexOption.IGNORE_CASE) to
        ErrorHelp("Blocked in your country", "This video is not offered where you are.", null),
    Regex("http error 403|forbidden|unable to extract|nsig|signature|player response|precondition|po token|sabr", RegexOption.IGNORE_CASE) to
        ErrorHelp("YouTube changed something", "This is almost always fixed by updating yt-dlp. Update, then retry.", ErrorFix.UPDATE_YTDLP),
    Regex("http error 429|too many requests|rate.?limit", RegexOption.IGNORE_CASE) to
        ErrorHelp("YouTube is rate limiting you", "Wait a few minutes or download fewer videos at once, then retry.", ErrorFix.RETRY),
    Regex("unable to resolve host|timed out|timeout|connection (reset|refused|aborted)|network is unreachable|unable to download webpage|failed to connect", RegexOption.IGNORE_CASE) to
        ErrorHelp("Network problem", "Check your connection and retry.", ErrorFix.RETRY),
    Regex("no space left|enospc|disk full", RegexOption.IGNORE_CASE) to
        ErrorHelp("The phone is full", "Free some space, then retry.", ErrorFix.RETRY),
    Regex("requested format is not available|format is not available", RegexOption.IGNORE_CASE) to
        ErrorHelp("That quality is not offered", "Pick Best or a lower resolution and retry.", ErrorFix.RETRY),
)

fun explainError(message: String?): ErrorHelp? {
    if (message.isNullOrBlank()) return null
    return RULES.firstOrNull { it.first.containsMatchIn(message) }?.second
}
