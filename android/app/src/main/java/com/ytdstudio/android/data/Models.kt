package com.ytdstudio.android.data

import org.json.JSONArray
import org.json.JSONObject

enum class DownloadMode { VIDEO, AUDIO }

enum class JobStatus {
    QUEUED, DOWNLOADING, PROCESSING, SAVING, COMPLETED, FAILED, CANCELED;

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
        get() = when (mode) {
            DownloadMode.AUDIO -> audioFormat.uppercase() + " audio"
            DownloadMode.VIDEO -> if (height > 0) "Video up to ${height}p" else "Video, best quality"
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
)

data class PlaylistEntry(
    val id: String,
    val url: String,
    val title: String,
    val uploader: String?,
    val duration: Double?,
    val thumbnail: String?,
)

fun JSONObject.optStringOrNull(key: String): String? =
    if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
