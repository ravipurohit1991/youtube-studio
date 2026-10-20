package com.ytdstudio.android.engine

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/** A part of a video to jump over while watching (seconds on YouTube's timeline). */
data class SkipSegment(val start: Double, val end: Double, val category: String, val videoDuration: Double)

/**
 * SponsorBlock segments for skipping while watching (downloads cut them out with yt-dlp instead).
 * Privacy, as on desktop: only the first 4 hex characters of the video id's SHA-256 are sent, and the
 * matching video is picked out of the answer here, so the server never learns which video is playing.
 */
object SponsorBlock {
    private const val TAG = "SponsorBlock"
    private const val BASE = "https://sponsor.ajay.app"
    private const val TTL_MS = 60 * 60 * 1000L
    private val CATEGORIES = listOf("sponsor", "selfpromo", "interaction")
    private val VIDEO_ID = Regex("^[\\w-]{11}$")
    private val cache = ConcurrentHashMap<String, Pair<Long, List<SkipSegment>>>()

    val LABELS = mapOf("sponsor" to "sponsor", "selfpromo" to "self-promotion", "interaction" to "\"subscribe\" reminder")

    /** The video id of a YouTube watch / youtu.be / shorts link, or null. */
    fun videoIdOf(url: String?): String? {
        if (url == null) return null
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        val host = (uri.host ?: "").removePrefix("www.").removePrefix("m.").removePrefix("music.")
        val parts = (uri.path ?: "").split('/').filter { it.isNotEmpty() }
        val id = when {
            host == "youtu.be" -> parts.firstOrNull()
            parts.size >= 2 && parts[0] in listOf("shorts", "embed", "live") -> parts[1]
            else -> uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("v=") }?.removePrefix("v=")
        }
        return id?.takeIf { VIDEO_ID.matches(it) }
    }

    /** Segments of a video, sorted; empty when there are none or SponsorBlock cannot be reached. */
    suspend fun segments(videoId: String): List<SkipSegment> = withContext(Dispatchers.IO) {
        if (!VIDEO_ID.matches(videoId)) return@withContext emptyList()
        cache[videoId]?.let { (at, list) -> if (System.currentTimeMillis() - at < TTL_MS) return@withContext list }
        val prefix = MessageDigest.getInstance("SHA-256").digest(videoId.toByteArray()).joinToString("") { "%02x".format(it) }.take(4)
        val query = "categories=" + URLEncoder.encode(JSONArray(CATEGORIES).toString(), "UTF-8") +
            "&actionTypes=" + URLEncoder.encode("[\"skip\"]", "UTF-8")
        val list = try {
            val conn = URI("$BASE/api/skipSegments/$prefix?$query").toURL().openConnection() as HttpURLConnection
            conn.connectTimeout = 7000
            conn.readTimeout = 7000
            conn.setRequestProperty("User-Agent", "YTD-Studio")
            try {
                when (conn.responseCode) {
                    200 -> parse(conn.inputStream.bufferedReader().use { it.readText() }, videoId)
                    404 -> emptyList() // nothing submitted for any video with this prefix
                    else -> {
                        Log.w(TAG, "status ${conn.responseCode}")
                        return@withContext emptyList()
                    }
                }
            } finally {
                conn.disconnect()
            }
        } catch (e: Exception) {
            // Offline or blocked: watching simply goes on without skipping (and asks again next time).
            Log.w(TAG, "unavailable: ${e.message}")
            return@withContext emptyList()
        }
        cache[videoId] = System.currentTimeMillis() to list
        list
    }

    private fun parse(body: String, videoId: String): List<SkipSegment> {
        val videos = JSONArray(body)
        for (i in 0 until videos.length()) {
            val video = videos.optJSONObject(i) ?: continue
            if (video.optString("videoID") != videoId) continue
            val segments = video.optJSONArray("segments") ?: return emptyList()
            return (0 until segments.length()).mapNotNull { j ->
                val s = segments.optJSONObject(j) ?: return@mapNotNull null
                val range = s.optJSONArray("segment") ?: return@mapNotNull null
                val action = s.optString("actionType", "skip")
                val start = range.optDouble(0, -1.0)
                val end = range.optDouble(1, -1.0)
                if (action != "skip" || start < 0 || end - start < 1) return@mapNotNull null
                SkipSegment(start, end, s.optString("category", "sponsor"), s.optDouble("videoDuration", 0.0))
            }.sortedBy { it.start }
        }
        return emptyList()
    }
}
