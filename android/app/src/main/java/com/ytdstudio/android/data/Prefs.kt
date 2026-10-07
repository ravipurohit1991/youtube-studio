package com.ytdstudio.android.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class Settings(
    val defaultMode: DownloadMode = DownloadMode.VIDEO,
    /** 0 = best available. 1080 keeps H.264, which every phone decodes in hardware. */
    val preferredHeight: Int = 1080,
    /** m4a is YouTube's own audio, saved without re-encoding (fast, no quality loss). */
    val audioFormat: String = "m4a",
    val autoUpdateYtdlp: Boolean = true,
    val concurrentDownloads: Int = 2,
    /** Playlist downloads go into their own subfolder, which the Library shows as a playlist. */
    val playlistFolders: Boolean = true,
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    /** Material You colors from the wallpaper (Android 12+) instead of the app's own palette. */
    val dynamicColor: Boolean = false,
    /** Accent color preset (same names as the desktop app): crimson, violet, ocean, emerald, amber, rose. */
    val accent: String = "crimson",
    /** Start where you left off. */
    val resumePlayback: Boolean = true,
    /** Videos keep playing (as audio) when you leave the player. Audio always does. */
    val backgroundVideo: Boolean = false,
    /** Leaving the player while a video plays shrinks it into a floating window. */
    val pictureInPicture: Boolean = true,
    /** "compatible" prefers H.264 (plays everywhere); "best" allows VP9/AV1 when they are better. */
    val videoCodec: String = "compatible",
    /** yt-dlp --limit-rate value, e.g. "2M"; empty = unlimited. */
    val rateLimit: String = "",
    /** Cut sponsor segments out of downloads by default (SponsorBlock). */
    val sponsorBlock: Boolean = false,
    /** Embed tags and chapters into downloaded files (cover art is always embedded for audio). */
    val embedMetadata: Boolean = true,
    /** Sync followed playlists and channels when the app opens, if the last sync is older than this (0 = off). */
    val autoSyncHours: Int = 0,
    /** Ollama server for the AI features: Ollama Cloud or a local/self-hosted Ollama. */
    val aiHost: String = "https://ollama.com",
    /** Model the AI features use, as listed by the server (for example gpt-oss:120b). */
    val aiModel: String = "",
    /** Discover uses your library, favorites and feedback as a taste profile. */
    val aiPersonalize: Boolean = true,
    /** Discover looks the request up with Ollama web search before planning searches. */
    val aiUseWeb: Boolean = false,
)

/** A video watched as a stream, for "Recently streamed". */
data class StreamEntry(val url: String, val videoId: String?, val title: String, val uploader: String?, val thumbnail: String?, val at: Long)

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(read())
    val settings: StateFlow<Settings> = state.asStateFlow()
    private val streamState = MutableStateFlow(readStreams())
    val streams: StateFlow<List<StreamEntry>> = streamState.asStateFlow()

    var lastYtdlpCheck: Long
        get() = sp.getLong("lastYtdlpCheck", 0)
        set(value) = sp.edit().putLong("lastYtdlpCheck", value).apply()

    private fun read(): Settings {
        val d = Settings()
        return Settings(
            defaultMode = runCatching { DownloadMode.valueOf(sp.getString("defaultMode", d.defaultMode.name)!!) }.getOrDefault(d.defaultMode),
            preferredHeight = sp.getInt("preferredHeight", d.preferredHeight),
            audioFormat = sp.getString("audioFormat", d.audioFormat)!!.takeIf { it in AUDIO_FORMATS } ?: d.audioFormat,
            autoUpdateYtdlp = sp.getBoolean("autoUpdateYtdlp", d.autoUpdateYtdlp),
            concurrentDownloads = sp.getInt("concurrentDownloads", d.concurrentDownloads).coerceIn(1, 3),
            playlistFolders = sp.getBoolean("playlistFolders", d.playlistFolders),
            themeMode = runCatching { ThemeMode.valueOf(sp.getString("themeMode", d.themeMode.name)!!) }.getOrDefault(d.themeMode),
            dynamicColor = sp.getBoolean("dynamicColor", d.dynamicColor),
            accent = sp.getString("accent", d.accent)!!.takeIf { it in ACCENTS } ?: d.accent,
            resumePlayback = sp.getBoolean("resumePlayback", d.resumePlayback),
            backgroundVideo = sp.getBoolean("backgroundVideo", d.backgroundVideo),
            pictureInPicture = sp.getBoolean("pictureInPicture", d.pictureInPicture),
            videoCodec = sp.getString("videoCodec", d.videoCodec)!!.takeIf { it == "compatible" || it == "best" } ?: d.videoCodec,
            rateLimit = sp.getString("rateLimit", d.rateLimit)!!.takeIf { it in RATE_LIMITS } ?: d.rateLimit,
            sponsorBlock = sp.getBoolean("sponsorBlock", d.sponsorBlock),
            embedMetadata = sp.getBoolean("embedMetadata", d.embedMetadata),
            autoSyncHours = sp.getInt("autoSyncHours", d.autoSyncHours).takeIf { it in SYNC_HOURS } ?: 0,
            aiHost = sp.getString("aiHost", d.aiHost)!!.trim().trimEnd('/').ifEmpty { d.aiHost },
            aiModel = sp.getString("aiModel", d.aiModel)!!,
            aiPersonalize = sp.getBoolean("aiPersonalize", d.aiPersonalize),
            aiUseWeb = sp.getBoolean("aiUseWeb", d.aiUseWeb),
        )
    }

    fun update(transform: (Settings) -> Settings) {
        val next = transform(state.value)
        sp.edit()
            .putString("defaultMode", next.defaultMode.name)
            .putInt("preferredHeight", next.preferredHeight)
            .putString("audioFormat", next.audioFormat)
            .putBoolean("autoUpdateYtdlp", next.autoUpdateYtdlp)
            .putInt("concurrentDownloads", next.concurrentDownloads.coerceIn(1, 3))
            .putBoolean("playlistFolders", next.playlistFolders)
            .putString("themeMode", next.themeMode.name)
            .putBoolean("dynamicColor", next.dynamicColor)
            .putString("accent", next.accent)
            .putBoolean("resumePlayback", next.resumePlayback)
            .putBoolean("backgroundVideo", next.backgroundVideo)
            .putBoolean("pictureInPicture", next.pictureInPicture)
            .putString("videoCodec", next.videoCodec)
            .putString("rateLimit", next.rateLimit)
            .putBoolean("sponsorBlock", next.sponsorBlock)
            .putBoolean("embedMetadata", next.embedMetadata)
            .putInt("autoSyncHours", next.autoSyncHours)
            .putString("aiHost", next.aiHost)
            .putString("aiModel", next.aiModel)
            .putBoolean("aiPersonalize", next.aiPersonalize)
            .putBoolean("aiUseWeb", next.aiUseWeb)
            .apply()
        state.value = next
    }

    /** Settings as JSON for a backup (the AI key is never part of it). */
    fun exportJson(): JSONObject {
        val s = state.value
        return JSONObject()
            .put("defaultMode", s.defaultMode.name).put("preferredHeight", s.preferredHeight).put("audioFormat", s.audioFormat)
            .put("autoUpdateYtdlp", s.autoUpdateYtdlp).put("concurrentDownloads", s.concurrentDownloads).put("playlistFolders", s.playlistFolders)
            .put("themeMode", s.themeMode.name).put("dynamicColor", s.dynamicColor).put("accent", s.accent)
            .put("resumePlayback", s.resumePlayback).put("backgroundVideo", s.backgroundVideo).put("pictureInPicture", s.pictureInPicture)
            .put("videoCodec", s.videoCodec).put("rateLimit", s.rateLimit).put("sponsorBlock", s.sponsorBlock).put("embedMetadata", s.embedMetadata)
            .put("autoSyncHours", s.autoSyncHours).put("aiHost", s.aiHost).put("aiModel", s.aiModel)
            .put("aiPersonalize", s.aiPersonalize).put("aiUseWeb", s.aiUseWeb)
    }

    fun importJson(o: JSONObject) {
        val editor = sp.edit()
        o.keys().forEach { key ->
            when (val value = o.get(key)) {
                is Boolean -> editor.putBoolean(key, value)
                is Int -> editor.putInt(key, value)
                is String -> editor.putString(key, value)
            }
        }
        editor.apply()
        state.value = read()
    }

    fun rememberStream(entry: StreamEntry) {
        val next = (listOf(entry) + streamState.value.filterNot { it.url == entry.url || (entry.videoId != null && it.videoId == entry.videoId) }).take(MAX_STREAMS)
        streamState.value = next
        sp.edit().putString("streams", JSONArray().apply {
            next.forEach { put(JSONObject().put("url", it.url).put("videoId", it.videoId).put("title", it.title).put("uploader", it.uploader).put("thumbnail", it.thumbnail).put("at", it.at)) }
        }.toString()).apply()
    }

    fun clearStreams() {
        streamState.value = emptyList()
        sp.edit().remove("streams").apply()
    }

    private fun readStreams(): List<StreamEntry> = try {
        JSONArray(sp.getString("streams", "[]")).objects().mapNotNull {
            val url = it.optStringOrNull("url") ?: return@mapNotNull null
            StreamEntry(url, it.optStringOrNull("videoId"), it.optString("title", url), it.optStringOrNull("uploader"), it.optStringOrNull("thumbnail"), it.optLong("at"))
        }
    } catch (e: Exception) {
        emptyList()
    }

    companion object {
        val AUDIO_FORMATS = listOf("m4a", "mp3", "opus")
        val HEIGHTS = listOf(0, 2160, 1440, 1080, 720, 480, 360)
        val ACCENTS = listOf("crimson", "violet", "ocean", "emerald", "amber", "rose")
        val RATE_LIMITS = listOf("", "500K", "1M", "2M", "5M", "10M")
        val SYNC_HOURS = listOf(0, 1, 3, 6, 12, 24)
        private const val MAX_STREAMS = 24
    }
}
