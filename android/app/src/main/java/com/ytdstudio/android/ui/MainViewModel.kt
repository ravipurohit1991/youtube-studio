package com.ytdstudio.android.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.DownloadRequest
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.PlaylistEntry
import com.ytdstudio.android.data.VideoMeta
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.service.DownloadService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class Tab { DOWNLOAD, STREAM, LIBRARY, SETTINGS }

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ytd = app as YtdApp
    val prefs = ytd.prefs
    val store = ytd.jobs

    var tab by mutableStateOf(Tab.DOWNLOAD)

    // Download tab
    var url by mutableStateOf("")
    var analyzing by mutableStateOf(false)
    var meta by mutableStateOf<VideoMeta?>(null)
    var analyzeError by mutableStateOf<String?>(null)
    var mode by mutableStateOf(prefs.settings.value.defaultMode)
    var height by mutableStateOf(prefs.settings.value.preferredHeight)
    var audioFormat by mutableStateOf(prefs.settings.value.audioFormat)
    var selected by mutableStateOf(setOf<String>())
    var message by mutableStateOf<String?>(null)

    // Stream tab
    var streamUrl by mutableStateOf("")
    var streamLoading by mutableStateOf(false)
    var streamError by mutableStateOf<String?>(null)
    var streamHeight by mutableStateOf(720)
    var streamAudioOnly by mutableStateOf(false)

    // Library tab
    var library by mutableStateOf(emptyList<LibraryItem>())
    var libraryLoading by mutableStateOf(false)

    fun analyze(target: String = url) {
        val link = target.trim()
        if (link.isEmpty()) {
            message = "Paste a YouTube link first."
            return
        }
        url = link
        analyzing = true
        analyzeError = null
        meta = null
        viewModelScope.launch {
            try {
                val result = Engine.probe(link)
                meta = result
                selected = result.entries.map { it.id }.toSet()
            } catch (e: Exception) {
                analyzeError = e.message ?: "Could not read that link."
            } finally {
                analyzing = false
            }
        }
    }

    /** Shared from the YouTube app (or pasted): fill in and analyze right away. */
    fun receiveSharedText(text: String?) {
        val link = extractUrl(text) ?: return
        tab = Tab.DOWNLOAD
        analyze(link)
    }

    fun download() {
        val m = meta ?: return
        val requests = if (m.isPlaylist) {
            m.entries.filter { it.id in selected }.map { request(it) }
        } else {
            listOf(DownloadRequest(m.url, mode, height, audioFormat, m.title, m.uploader, m.thumbnail, m.duration))
        }
        if (requests.isEmpty()) {
            message = "Pick at least one video."
            return
        }
        requests.forEach { store.add(it) }
        DownloadService.kick(getApplication())
        message = if (requests.size == 1) "Download started." else "${requests.size} downloads queued."
    }

    private fun request(e: PlaylistEntry) = DownloadRequest(e.url, mode, height, audioFormat, e.title, e.uploader, e.thumbnail, e.duration)

    fun cancel(id: String) = DownloadService.cancel(getApplication(), id)

    fun retry(id: String) {
        store.retry(id)
        DownloadService.kick(getApplication())
    }

    fun remove(id: String) {
        val job = store.get(id) ?: return
        if (job.status.isActive) cancel(id)
        store.remove(id)
    }

    fun clearFinished() = store.clearFinished()

    fun stream(onReady: (Engine.StreamSource) -> Unit) {
        val link = streamUrl.trim()
        if (link.isEmpty()) {
            streamError = "Paste a YouTube link first."
            return
        }
        streamLoading = true
        streamError = null
        viewModelScope.launch {
            try {
                onReady(Engine.resolveStream(link, streamHeight, streamAudioOnly))
            } catch (e: Exception) {
                streamError = e.message ?: "Could not start playback."
            } finally {
                streamLoading = false
            }
        }
    }

    fun refreshLibrary() {
        libraryLoading = true
        viewModelScope.launch {
            library = withContext(Dispatchers.IO) { MediaLibrary.query(getApplication()) }
            libraryLoading = false
        }
    }
}
