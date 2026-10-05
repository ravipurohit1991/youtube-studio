package com.ytdstudio.android.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.ai.DiscoverVideo
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.DownloadRequest
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.PlaylistEntry
import com.ytdstudio.android.data.SavedPlaylist
import com.ytdstudio.android.data.VideoMeta
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.service.DownloadService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class Tab { HOME, DISCOVER, LIBRARY, DOWNLOADS, SETTINGS }

/** A playlist in the Library: a downloaded YouTube playlist (its folder) or one the user made. */
sealed interface PlaylistRef {
    data class Folder(val name: String) : PlaylistRef
    data class User(val id: String) : PlaylistRef
}

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val ytd = app as YtdApp
    val prefs = ytd.prefs
    val store = ytd.jobs
    val library = ytd.library

    var tab by mutableStateOf(Tab.HOME)
    var message by mutableStateOf<String?>(null)

    // Link flow: paste or share a link, then watch it or download it.
    var url by mutableStateOf("")
    var sheetOpen by mutableStateOf(false)
    var analyzing by mutableStateOf(false)
    var meta by mutableStateOf<VideoMeta?>(null)
    var analyzeError by mutableStateOf<String?>(null)
    var mode by mutableStateOf(prefs.settings.value.defaultMode)
    var height by mutableStateOf(prefs.settings.value.preferredHeight)
    var audioFormat by mutableStateOf(prefs.settings.value.audioFormat)
    var selected by mutableStateOf(setOf<String>())
    var keepSynced by mutableStateOf(true)
    var resolvingStream by mutableStateOf<String?>(null)

    // Library
    var items by mutableStateOf(emptyList<LibraryItem>())
    var libraryLoading by mutableStateOf(false)
    var libraryLoaded by mutableStateOf(false)
    /** 0 videos, 1 music, 2 playlists, 3 favorites. */
    var libraryTab by mutableStateOf(0)
    var openPlaylist by mutableStateOf<PlaylistRef?>(null)
    var pendingDelete by mutableStateOf<LibraryItem?>(null)
    var addToPlaylist by mutableStateOf<List<String>?>(null)
    var syncing by mutableStateOf(setOf<String>())

    fun analyze(target: String = url) {
        val link = target.trim()
        if (link.isEmpty()) {
            message = "Paste a YouTube link first."
            return
        }
        url = link
        sheetOpen = true
        analyzing = true
        analyzeError = null
        meta = null
        val defaults = prefs.settings.value
        mode = defaults.defaultMode
        height = defaults.preferredHeight
        audioFormat = defaults.audioFormat
        viewModelScope.launch {
            try {
                val result = Engine.probe(link)
                meta = result
                selected = result.entries.map { it.id }.toSet()
                keepSynced = true
            } catch (e: Exception) {
                analyzeError = e.message ?: "Could not read that link."
            } finally {
                analyzing = false
            }
        }
    }

    fun closeSheet() {
        sheetOpen = false
    }

    /** Shared from the YouTube app (or pasted): fill in and analyze right away. */
    fun receiveSharedText(text: String?) {
        val link = extractUrl(text) ?: return
        tab = Tab.HOME
        openPlaylist = null
        analyze(link)
    }

    fun download() {
        val m = meta ?: return
        val requests = if (m.isPlaylist) {
            val folder = if (prefs.settings.value.playlistFolders) MediaLibrary.safeFolder(m.title) else null
            val picked = m.entries.withIndex().filter { it.value.id in selected }
            if (picked.isNotEmpty() && keepSynced && m.id != null) {
                library.upsertSaved(
                    SavedPlaylist(
                        id = m.id, url = m.url, title = m.title, folder = folder, mode = mode, height = height,
                        audioFormat = audioFormat, thumbnail = m.thumbnail,
                        // Whatever was left unticked now is not fetched by a later sync either.
                        knownIds = m.entries.map { it.id }.toSet(), lastSync = System.currentTimeMillis(), lastAdded = picked.size,
                    ),
                )
            }
            picked.map { (i, e) -> request(e, folder, i + 1, mode, height, audioFormat) }
        } else {
            listOf(DownloadRequest(m.url, mode, height, audioFormat, m.title, m.uploader, m.thumbnail, m.duration, videoId = m.id))
        }
        if (requests.isEmpty()) {
            message = "Pick at least one video."
            return
        }
        store.addAll(requests)
        DownloadService.kick(getApplication())
        sheetOpen = false
        message = if (requests.size == 1) "Download started." else "${requests.size} downloads queued."
    }

    private fun request(e: PlaylistEntry, folder: String?, index: Int, mode: DownloadMode, height: Int, audioFormat: String) =
        DownloadRequest(e.url, mode, height, audioFormat, e.title, e.uploader, e.thumbnail, e.duration, videoId = e.id, folder = folder, playlistIndex = index)

    /** Stream a link (or one playlist entry) without saving it. */
    fun watch(link: String, title: String?, thumbnail: String?, audioOnly: Boolean, onReady: (Engine.StreamSource, String?) -> Unit) {
        if (resolvingStream != null) return
        resolvingStream = link
        val preferred = prefs.settings.value.preferredHeight
        // Streams are capped at 1080p: higher resolutions are VP9/AV1 only and stutter on many phones.
        val streamHeight = if (preferred == 0 || preferred > 1080) 1080 else preferred
        viewModelScope.launch {
            try {
                val source = Engine.resolveStream(link, streamHeight, audioOnly)
                onReady(if (title != null && source.title == link) source.copy(title = title) else source, thumbnail)
            } catch (e: Exception) {
                message = e.message ?: "Could not start playback."
            } finally {
                resolvingStream = null
            }
        }
    }

    /** Download videos picked in Discover, with the default quality and audio format. */
    fun queueDiscover(videos: List<DiscoverVideo>, mode: DownloadMode) {
        if (videos.isEmpty()) return
        val s = prefs.settings.value
        store.addAll(videos.map { v -> DownloadRequest(v.url, mode, s.preferredHeight, s.audioFormat, v.title, v.channel, v.thumbnail, v.duration, videoId = v.id) })
        DownloadService.kick(getApplication())
        message = if (videos.size == 1) "Download started." else "${videos.size} downloads queued."
    }

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

    fun refreshLibrary() {
        libraryLoading = true
        viewModelScope.launch {
            items = withContext(Dispatchers.IO) { MediaLibrary.query(getApplication()) }
            libraryLoading = false
            libraryLoaded = true
        }
    }

    /** Check a saved YouTube playlist for videos added since the last sync and download only those. */
    fun sync(saved: SavedPlaylist) {
        if (saved.id in syncing) return
        syncing = syncing + saved.id
        viewModelScope.launch {
            try {
                val fresh = Engine.probe(saved.url)
                val added = fresh.entries.withIndex().filter { it.value.id !in saved.knownIds }
                if (added.isNotEmpty()) {
                    store.addAll(added.map { (i, e) -> request(e, saved.folder, i + 1, saved.mode, saved.height, saved.audioFormat) })
                    DownloadService.kick(getApplication())
                }
                library.markSynced(saved.id, added.map { it.value.id })
                message = if (added.isEmpty()) "${saved.title} is up to date." else "${saved.title}: ${added.size} new video(s) queued."
            } catch (e: Exception) {
                message = "Sync failed: " + (e.message ?: "unknown error")
            } finally {
                syncing = syncing - saved.id
            }
        }
    }

    fun syncAll() = library.state.value.saved.forEach { sync(it) }

    /** Items of a playlist, in play order. */
    fun playlistItems(ref: PlaylistRef): List<LibraryItem> = when (ref) {
        is PlaylistRef.Folder -> items.filter { it.folder == ref.name }.sortedBy { it.name.lowercase() }
        is PlaylistRef.User -> {
            val byKey = items.associateBy { it.key }
            library.state.value.playlists.firstOrNull { it.id == ref.id }?.items.orEmpty().mapNotNull { byKey[it] }
        }
    }

    fun playlistTitle(ref: PlaylistRef): String = when (ref) {
        is PlaylistRef.Folder -> ref.name
        is PlaylistRef.User -> library.state.value.playlists.firstOrNull { it.id == ref.id }?.name ?: "Playlist"
    }

    /** The synced YouTube playlist that downloads into this folder, if any. */
    fun savedFor(folder: String): SavedPlaylist? = library.state.value.saved.firstOrNull { it.folder == folder }

    fun forgetDeleted(item: LibraryItem) {
        library.forget(item.key)
        items = items.filterNot { it.key == item.key }
    }
}
