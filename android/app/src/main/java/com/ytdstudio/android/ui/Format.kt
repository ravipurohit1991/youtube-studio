package com.ytdstudio.android.ui

import kotlin.math.roundToLong

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var value = bytes.toDouble()
    var unit = 0
    while (value >= 1024 && unit < units.lastIndex) {
        value /= 1024
        unit++
    }
    return (if (value >= 10 || unit == 0) value.roundToLong().toString() else String.format("%.1f", value)) + " " + units[unit]
}

fun formatDuration(seconds: Double?): String {
    if (seconds == null || seconds <= 0 || seconds.isNaN()) return "--:--"
    val total = seconds.roundToLong()
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** First http(s) link in shared text ("Check this out https://youtu.be/..."). */
fun extractUrl(text: String?): String? =
    text?.let { Regex("https?://\\S+").find(it)?.value?.trimEnd('.', ',', ')', '"', '\'') }

fun formatCount(count: Long): String = when {
    count >= 1_000_000_000 -> "%.1fB".format(count / 1_000_000_000.0)
    count >= 1_000_000 -> "%.1fM".format(count / 1_000_000.0)
    count >= 1_000 -> "%.1fK".format(count / 1_000.0)
    else -> count.toString()
}

/** "3h ago", "just now": how long since [ms]. */
fun timeAgo(ms: Long): String {
    if (ms <= 0) return "never"
    val minutes = (System.currentTimeMillis() - ms) / 60_000
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "${minutes}m ago"
        minutes < 60 * 24 -> "${minutes / 60}h ago"
        else -> "${minutes / (60 * 24)}d ago"
    }
}
