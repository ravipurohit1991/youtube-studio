package com.ytdstudio.android.data

import org.json.JSONArray
import org.json.JSONObject

enum class DownloadMode { VIDEO, AUDIO }

enum class JobStatus {
    QUEUED, DOWNLOADING, PROCESSING, SAVING, PAUSED, COMPLETED, FAILED, CANCELED;

    val isActive: Boolean get() = this == DOWNLOADING || this == PROCESSING || this == SAVING
    val isFinished: Boolean get() = this == COMPLETED || this == FAILED || this == CANCELED
}

/** What the user asked for. Mirrors the desktop DownloadRequest. */
data class DownloadRequest(
    val url: String,
    val mode: DownloadMode,
    /** Max video height; 0 means best available. */
    val height: Int,
    val audioFormat: String,
    val title: String? = null,
    val uploader: String? = null,
    val thumbnail: String? = null,
    val duration: Double? = null,
    val videoId: String? = null,
    /** Set for playlist downloads: the file is saved in a subfolder with this name. */
    val folder: String? = null,
    /** 1-based position in the playlist; prefixes the file name so the folder keeps playlist order. */
    val playlistIndex: Int? = null,
    /** Only this part of the video, in seconds (null = from the start / to the end). */
    val clipStart: Double? = null,
    val clipEnd: Double? = null,
    /** Cut sponsor segments out (SponsorBlock). */
    val sponsorBlock: Boolean = false,
)

data class DownloadJob(
    val id: String,
    val url: String,
    val mode: DownloadMode,
    val height: Int,
    val audioFormat: String,
    val title: String,
    val uploader: String?,
    val thumbnail: String?,
    val duration: Double?,
    val videoId: String? = null,
    val folder: String? = null,
    val playlistIndex: Int? = null,
    val clipStart: Double? = null,
    val clipEnd: Double? = null,
    val sponsorBlock: Boolean = false,
    val status: JobStatus = JobStatus.QUEUED,
    val percent: Float = 0f,
    val downloadedBytes: Long = 0,
    val totalBytes: Long = 0,
    val speed: String? = null,
    val eta: String? = null,
    /** content:// URI of the saved file in the shared Movies/Music collection. */
    val outputUri: String? = null,
    val outputName: String? = null,
    val error: String? = null,
    /** What is happening right now, e.g. "Downloading video", "Merging video and audio". */
    val stage: String? = "Waiting in queue",
    val log: String = "",
    val createdAt: Long = System.currentTimeMillis(),
    val finishedAt: Long? = null,
) {
    val qualityLabel: String
        get() = listOfNotNull(
            when (mode) {
                DownloadMode.AUDIO -> audioFormat.uppercase() + " audio"
                DownloadMode.VIDEO -> if (height > 0) "Video up to ${height}p" else "Video, best quality"
            },
            if (clipStart != null || clipEnd != null) "clip " + clock(clipStart ?: 0.0) + "–" + (clipEnd?.let { clock(it) } ?: "end") else null,
            if (sponsorBlock) "no sponsors" else null,
        ).joinToString(" · ")

    /** yt-dlp --download-sections value, or null for the whole video. */
    val section: String?
        get() {
            val from = clipStart?.takeIf { it > 0 }
            val to = clipEnd?.takeIf { it > 0 }
            if (from == null && to == null) return null
            if (from != null && to != null && to <= from) return null
            return "*" + (from?.toLong() ?: 0) + "-" + (to?.toLong()?.toString() ?: "inf")
        }

    /** "007 - " for the 7th video of a playlist download, so files sort in playlist order. */
    val filePrefix: String
        get() = if (folder != null && playlistIndex != null) "%03d - ".format(playlistIndex) else ""

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("url", url)
        put("mode", mode.name)
        put("height", height)
        put("audioFormat", audioFormat)
        put("title", title)
        put("uploader", uploader)
        put("thumbnail", thumbnail)
        put("duration", duration)
        put("videoId", videoId)
        put("folder", folder)
        put("playlistIndex", playlistIndex)
        put("clipStart", clipStart)
        put("clipEnd", clipEnd)
        put("sponsorBlock", sponsorBlock)
        put("status", status.name)
        put("percent", percent.toDouble())
        put("downloadedBytes", downloadedBytes)
        put("totalBytes", totalBytes)
        put("outputUri", outputUri)
        put("outputName", outputName)
        put("error", error)
        put("stage", stage)
        put("createdAt", createdAt)
        put("finishedAt", finishedAt)
    }

    companion object {
        fun fromJson(o: JSONObject): DownloadJob = DownloadJob(
            id = o.getString("id"),
            url = o.getString("url"),
            mode = runCatching { DownloadMode.valueOf(o.getString("mode")) }.getOrDefault(DownloadMode.VIDEO),
            height = o.optInt("height", 1080),
            audioFormat = o.optString("audioFormat", "m4a"),
            title = o.optString("title", o.getString("url")),
            uploader = o.optStringOrNull("uploader"),
            thumbnail = o.optStringOrNull("thumbnail"),
            duration = if (o.isNull("duration")) null else o.optDouble("duration"),
            videoId = o.optStringOrNull("videoId"),
            folder = o.optStringOrNull("folder"),
            playlistIndex = if (o.has("playlistIndex") && !o.isNull("playlistIndex")) o.optInt("playlistIndex") else null,
            clipStart = if (o.has("clipStart") && !o.isNull("clipStart")) o.optDouble("clipStart") else null,
            clipEnd = if (o.has("clipEnd") && !o.isNull("clipEnd")) o.optDouble("clipEnd") else null,
            sponsorBlock = o.optBoolean("sponsorBlock", false),
            status = runCatching { JobStatus.valueOf(o.getString("status")) }.getOrDefault(JobStatus.FAILED),
            percent = o.optDouble("percent", 0.0).toFloat(),
            downloadedBytes = o.optLong("downloadedBytes", 0),
            totalBytes = o.optLong("totalBytes", 0),
            outputUri = o.optStringOrNull("outputUri"),
            outputName = o.optStringOrNull("outputName"),
            error = o.optStringOrNull("error"),
            stage = o.optStringOrNull("stage"),
            createdAt = o.optLong("createdAt", System.currentTimeMillis()),
            finishedAt = if (o.isNull("finishedAt")) null else o.optLong("finishedAt"),
        )
    }
}

data class VideoMeta(
    val url: String,
    val id: String?,
    val title: String,
    val uploader: String?,
    val duration: Double?,
    val thumbnail: String?,
    val viewCount: Long?,
    /** Distinct video heights YouTube offers for this video, highest first. */
    val heights: List<Int>,
    val isPlaylist: Boolean,
    val entries: List<PlaylistEntry>,
    /** Estimated download size in bytes per height cap (0 = best), for the quality chips. */
    val sizes: Map<Int, Long> = emptyMap(),
    /** Estimated size of the audio track alone. */
    val audioSize: Long? = null,
)

data class PlaylistEntry(
    val id: String,
    val url: String,
    val title: String,
    val uploader: String?,
    val duration: Double?,
    val thumbnail: String?,
)

/** "1:05" or "1:02:03". */
fun clock(seconds: Double): String {
    val total = seconds.toLong().coerceAtLeast(0)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

/** "1:23", "83", "1:02:03" to seconds; null when empty or not a time. */
fun parseClock(text: String): Double? {
    val t = text.trim()
    if (t.isEmpty() || !Regex("^\\d+(:\\d{1,2}){0,2}$").matches(t)) return null
    return t.split(':').fold(0.0) { sum, part -> sum * 60 + part.toDouble() }
}

fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
