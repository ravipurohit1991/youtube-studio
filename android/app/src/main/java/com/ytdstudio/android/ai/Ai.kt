package com.ytdstudio.android.ai

import android.content.Context
import com.ytdstudio.android.data.LibraryStore
import com.ytdstudio.android.data.Prefs

/**
 * Entry point of the AI features (Discover, video insights, smart playlists), backed by Ollama.
 * Set up once from the Application; everything else reads its configuration from here.
 */
object Ai {
    lateinit var appContext: Context
        private set
    lateinit var prefs: Prefs
        private set
    lateinit var library: LibraryStore
        private set
    lateinit var vault: KeyVault
        private set
    lateinit var taste: TasteStore
        private set

    fun init(context: Context, prefs: Prefs, library: LibraryStore) {
        appContext = context.applicationContext
        this.prefs = prefs
        this.library = library
        vault = KeyVault(appContext)
        taste = TasteStore(appContext)
    }

    fun host(): String = AiCore.normalizeHost(prefs.settings.value.aiHost)

    fun status(): AiStatus {
        val key = vault.get()
        val host = host()
        return AiStatus(
            host = host,
            model = prefs.settings.value.aiModel,
            hasKey = key != null,
            keyHint = key?.takeLast(4),
            isCloud = AiCore.isCloudHost(host),
        )
    }

    /** Picked automatically when no model is chosen yet: strong general models first. */
    private val PREFERRED = listOf("gpt-oss:120b", "qwen3-next", "deepseek-v3", "kimi-k2", "glm-4", "qwen3", "gpt-oss:20b", "gpt-oss", "llama")

    fun preferredModel(models: List<AiModel>): String? =
        PREFERRED.firstNotNullOfOrNull { hint -> models.firstOrNull { it.name.startsWith(hint) }?.name } ?: models.firstOrNull()?.name
}
