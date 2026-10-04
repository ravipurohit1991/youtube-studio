package com.ytdstudio.android.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class Settings(
    val defaultMode: DownloadMode = DownloadMode.VIDEO,
    /** 0 = best available. 1080 keeps H.264, which every phone decodes in hardware. */
    val preferredHeight: Int = 1080,
    /** m4a is YouTube's own audio, saved without re-encoding (fast, no quality loss). */
    val audioFormat: String = "m4a",
    val autoUpdateYtdlp: Boolean = true,
    val concurrentDownloads: Int = 2,
)

class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("settings", Context.MODE_PRIVATE)
    private val state = MutableStateFlow(read())
    val settings: StateFlow<Settings> = state.asStateFlow()

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
            .apply()
        state.value = next
    }

    companion object {
        val AUDIO_FORMATS = listOf("m4a", "mp3", "opus")
        val HEIGHTS = listOf(0, 2160, 1440, 1080, 720, 480, 360)
    }
}
