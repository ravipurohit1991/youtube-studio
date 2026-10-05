package com.ytdstudio.android.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ytdstudio.android.ai.Ai
import com.ytdstudio.android.ai.AiCore
import com.ytdstudio.android.ai.AiModel
import com.ytdstudio.android.ai.ChatMessage
import com.ytdstudio.android.ai.Discover
import com.ytdstudio.android.ai.DiscoverLength
import com.ytdstudio.android.ai.DiscoverRecency
import com.ytdstudio.android.ai.DiscoverRequest
import com.ytdstudio.android.ai.DiscoverResult
import com.ytdstudio.android.ai.DiscoverVideo
import com.ytdstudio.android.ai.Insights
import com.ytdstudio.android.ai.Ollama
import com.ytdstudio.android.ai.OrganizeGroup
import com.ytdstudio.android.ai.TasteItem
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** State and actions of the AI features: settings, Discover and smart playlists. */
class AiViewModel(app: Application) : AndroidViewModel(app) {
    var status by mutableStateOf(Ai.status())
        private set
    var message by mutableStateOf<String?>(null)

    // ---------- settings ----------

    var models by mutableStateOf(emptyList<AiModel>())
        private set
    var modelsLoading by mutableStateOf(false)
        private set
    var modelsError by mutableStateOf<String?>(null)
        private set
    var testing by mutableStateOf(false)
        private set
    var testResult by mutableStateOf<String?>(null)
        private set

    fun refreshStatus() {
        status = Ai.status()
    }

    fun saveKey(raw: String): Boolean = try {
        Ai.vault.save(raw)
        refreshStatus()
        testResult = null
        message = "API key saved (encrypted with the Android Keystore)."
        loadModels(quiet = true)
        true
    } catch (e: Exception) {
        message = e.message ?: "Could not save the key."
        false
    }

    fun clearKey() {
        Ai.vault.clear()
        models = emptyList()
        testResult = null
        refreshStatus()
        message = "API key removed."
    }

    fun setHost(host: String) {
        Ai.prefs.update { it.copy(aiHost = AiCore.normalizeHost(host)) }
        models = emptyList()
        testResult = null
        modelsError = null
        refreshStatus()
        if (status.hasKey || !status.isCloud) loadModels(quiet = true)
    }

    fun setModel(name: String) {
        Ai.prefs.update { it.copy(aiModel = name) }
        testResult = null
        refreshStatus()
    }

    fun loadModels(quiet: Boolean = false) {
        if (modelsLoading) return
        modelsLoading = true
        modelsError = null
        viewModelScope.launch {
            try {
                val list = Ollama.listModels()
                models = list
                if (list.isEmpty()) modelsError = "The server lists no models." + if (status.isCloud) "" else " Pull one first, e.g. \"ollama pull gpt-oss:20b\"."
                if (list.isNotEmpty() && status.model.isBlank()) {
                    Ai.preferredModel(list)?.let { pick ->
                        setModel(pick)
                        if (!quiet) message = "Model set to $pick. Change it any time."
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                models = emptyList()
                modelsError = e.message
            } finally {
                modelsLoading = false
            }
        }
    }

    fun test() {
        testing = true
        testResult = null
        viewModelScope.launch {
            val started = System.currentTimeMillis()
            try {
                val reply = Ollama.chat(listOf(ChatMessage("user", "Reply with exactly: YTD Studio is connected.")), Ollama.Options(temperature = 0.0))
                testResult = status.model + " answered in " + "%.1f".format((System.currentTimeMillis() - started) / 1000.0) + "s: “" + reply.take(120) + "”"
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                message = "Connection test failed: " + (e.message ?: "unknown error")
            } finally {
                testing = false
            }
        }
    }

    // ---------- discover ----------

    /** The request being refined: the original ask plus follow-ups, and every video shown so far. */
    data class Session(val prompt: String, val refinements: List<String>, val shown: Set<String>)

    var prompt by mutableStateOf("")
    var avoid by mutableStateOf("")
    var length by mutableStateOf(DiscoverLength.ANY)
    var recency by mutableStateOf(DiscoverRecency.ANY)
    var session by mutableStateOf<Session?>(null)
        private set
    var result by mutableStateOf<DiscoverResult?>(null)
        private set
    var videos by mutableStateOf(emptyList<DiscoverVideo>())
        private set
    var discovering by mutableStateOf(false)
        private set
    var stage by mutableStateOf<String?>(null)
        private set
    private var discoverJob: Job? = null

    fun find(text: String = prompt) {
        val value = text.trim()
        prompt = text
        if (value.isEmpty()) {
            message = "Describe what you want to watch, or tap For you."
            return
        }
        run(Session(value, emptyList(), emptySet()), more = false)
    }

    fun forYou() = run(Session("", emptyList(), emptySet()), more = false)

    fun refine(text: String) {
        val s = session ?: return
        if (text.isBlank()) return
        run(s.copy(refinements = s.refinements + text.trim()), more = false)
    }

    fun undoRefine() {
        val s = session ?: return
        if (s.refinements.isEmpty()) return
        run(s.copy(refinements = s.refinements.dropLast(1)), more = false)
    }

    fun more() {
        session?.let { run(it, more = true) }
    }

    fun stopDiscover() {
        discoverJob?.cancel()
    }

    private fun run(next: Session, more: Boolean) {
        if (!status.ready) {
            message = "Set up AI in Settings first: add your Ollama API key and pick a model."
            return
        }
        discoverJob?.cancel()
        val settings = Ai.prefs.settings.value
        discovering = true
        stage = "Starting…"
        discoverJob = viewModelScope.launch {
            try {
                val res = Discover.run(
                    DiscoverRequest(
                        prompt = next.prompt,
                        refinements = next.refinements,
                        exclude = if (more) next.shown else emptySet(),
                        length = length,
                        recency = recency,
                        avoid = avoid,
                        personalize = settings.aiPersonalize,
                        useWeb = settings.aiUseWeb && status.hasKey,
                    ),
                ) { s -> viewModelScope.launch { stage = s } }
                val merged = if (more) videos + res.videos.filter { v -> videos.none { it.id == v.id } } else res.videos
                result = res
                videos = merged
                session = next.copy(shown = (if (more) next.shown else emptySet()) + merged.map { it.id })
                if (res.videos.isEmpty()) message = "Nothing new matched. Try loosening the filters or rephrasing."
                else if (res.unranked) message = "The model could not rank these, so they are in search order."
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                message = e.message ?: "Discover failed."
            } finally {
                discovering = false
                stage = null
            }
        }
    }

    fun like(v: DiscoverVideo) {
        val t = Ai.taste.state.value
        if (t.liked.any { it.id == v.id }) Ai.taste.clear(v.id) else Ai.taste.like(TasteItem(v.id, v.title, v.channel))
    }

    fun dislike(v: DiscoverVideo) {
        val t = Ai.taste.state.value
        if (t.disliked.any { it.id == v.id }) {
            Ai.taste.clear(v.id)
            return
        }
        Ai.taste.dislike(TasteItem(v.id, v.title, v.channel))
        videos = videos.filterNot { it.id == v.id }
        message = "Got it: fewer like “" + v.title.take(60) + "”."
    }

    fun hideChannel(channel: String) {
        Ai.taste.block(channel)
        videos = videos.filterNot { it.channel == channel }
        message = "$channel will not be suggested again."
    }

    // ---------- smart playlists ----------

    var organizing by mutableStateOf(false)
        private set
    var organizeStage by mutableStateOf<String?>(null)
        private set
    var groups by mutableStateOf<List<OrganizeGroup>?>(null)
        private set
    var organizeError by mutableStateOf<String?>(null)
        private set
    private var organizeJob: Job? = null

    fun organize() {
        organizeJob?.cancel()
        organizing = true
        groups = null
        organizeError = null
        organizeJob = viewModelScope.launch {
            try {
                groups = Insights.organize { s -> viewModelScope.launch { organizeStage = s } }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                organizeError = e.message ?: "Could not group the library."
            } finally {
                organizing = false
                organizeStage = null
            }
        }
    }

    fun cancelOrganize() {
        organizeJob?.cancel()
        groups = null
        organizeError = null
    }

    fun createPlaylists(chosen: List<OrganizeGroup>) {
        chosen.forEach { Ai.library.createPlaylist(it.name, it.keys) }
        groups = null
        message = "${chosen.size} playlist(s) created."
    }
}
