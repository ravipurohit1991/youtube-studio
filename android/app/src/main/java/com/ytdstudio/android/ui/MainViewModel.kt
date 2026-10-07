package com.ytdstudio.android.ui

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ytdstudio.android.BuildConfig
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.ai.Ai
import com.ytdstudio.android.ai.DiscoverVideo
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.DownloadRequest
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.PlaylistEntry
import com.ytdstudio.android.data.SavedPlaylist
import com.ytdstudio.android.data.StreamEntry
import com.ytdstudio.android.data.VideoMeta
import com.ytdstudio.android.data.parseClock
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.service.DownloadService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

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
    /** Only part of a single video ("1:23" style), and cutting sponsors, for the next download. */
    var clipFrom by mutableStateOf("")
    var clipTo by mutableStateOf("")
    var sponsorBlock by mutableStateOf(prefs.settings.value.sponsorBlock)

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
    /** Library items picked for a bulk action (long-press to start). */
    var librarySelection by mutableStateOf(setOf<String>())
    var pendingBulkDelete by mutableStateOf<List<LibraryItem>?>(null)
    private var lastAutoSync = 0L

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
        sponsorBlock = defaults.sponsorBlock
        clipFrom = ""
        clipTo = ""
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

    /** The clip range typed in the sheet: (start, end), null = whole video, or an error message. */
    fun clipRange(): Pair<Pair<Double?, Double?>?, String?> {
        val from = clipFrom.trim()
        val to = clipTo.trim()
        if (from.isEmpty() && to.isEmpty()) return null to null
        val start = if (from.isEmpty()) null else parseClock(from) ?: return null to "Use a time like 1:23 or 83."
        val end = if (to.isEmpty()) null else parseClock(to) ?: return null to "Use a time like 1:23 or 83."
        if (start != null && end != null && end <= start) return null to "The end must come after the start."
        return (start to end) to null
    }

    fun download() {
        val m = meta ?: return
        val (clip, clipError) = if (m.isPlaylist) null to null else clipRange()
        if (clipError != null) {
            message = clipError
            return
        }
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
            picked.map { (i, e) -> request(e, folder, i + 1, mode, height, audioFormat).copy(sponsorBlock = sponsorBlock) }
        } else {
            listOf(
                DownloadRequest(
                    m.url, mode, height, audioFormat, m.title, m.uploader, m.thumbnail, m.duration, videoId = m.id,
                    clipStart = clip?.first, clipEnd = clip?.second, sponsorBlock = sponsorBlock,
                ),
            )
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
                val named = if (title != null && source.title == link) source.copy(title = title) else source
                val id = youTubeId(source.pageUrl ?: link)
                prefs.rememberStream(
                    StreamEntry(source.pageUrl ?: link, id, named.title, named.uploader, thumbnail ?: id?.let { "https://i.ytimg.com/vi/$it/mqdefault.jpg" }, System.currentTimeMillis()),
                )
                onReady(named, thumbnail)
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
        store.addAll(videos.map { v -> DownloadRequest(v.url, mode, s.preferredHeight, s.audioFormat, v.title, v.channel, v.thumbnail, v.duration, videoId = v.id, sponsorBlock = s.sponsorBlock) })
        DownloadService.kick(getApplication())
        message = if (videos.size == 1) "Download started." else "${videos.size} downloads queued."
    }

    fun cancel(id: String) = DownloadService.cancel(getApplication(), id)

    fun pause(id: String) {
        val job = store.get(id) ?: return
        if (job.status.isActive) DownloadService.pause(getApplication(), id) else store.pause(id)
    }

    fun resume(id: String) {
        store.resume(id)
        DownloadService.kick(getApplication())
    }

    fun prioritize(id: String) {
        store.prioritize(id)
        DownloadService.kick(getApplication())
    }

    fun pauseAll() = DownloadService.pauseAll(getApplication())

    fun resumeAll() {
        val n = store.resumeAll()
        if (n > 0) DownloadService.kick(getApplication())
        message = if (n > 0) "$n download(s) resumed." else "Nothing is paused."
    }

    fun retryFailed() {
        val n = store.retryFailed()
        if (n > 0) DownloadService.kick(getApplication())
        message = if (n > 0) "$n download(s) retried." else "No failed downloads."
    }

    fun updateYtdlpAndRetry(id: String) {
        Engine.updateYtdlp()
        viewModelScope.launch {
            Engine.awaitReady()
            retry(id)
        }
    }

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

    /** Auto-sync (Settings): when the app opens, sync followed playlists whose last sync is too old. */
    fun autoSyncIfDue() {
        val hours = prefs.settings.value.autoSyncHours
        val now = System.currentTimeMillis()
        if (hours <= 0 || now - lastAutoSync < 10 * 60 * 1000) return
        lastAutoSync = now
        viewModelScope.launch {
            Engine.awaitReady()
            library.state.value.saved.filter { now - it.lastSync >= hours * 3600_000L }.forEach { sync(it) }
        }
    }

    // ---------- library selection ----------

    fun toggleSelected(key: String) {
        librarySelection = if (key in librarySelection) librarySelection - key else librarySelection + key
    }

    fun clearSelection() {
        librarySelection = emptySet()
    }

    fun selectedItems(): List<LibraryItem> = items.filter { it.key in librarySelection }

    fun favoriteSelected() {
        val picked = selectedItems()
        val missing = picked.filter { it.key !in library.state.value.favorites }
        (missing.ifEmpty { picked }).forEach { library.toggleFavorite(it.key) }
        message = if (missing.isNotEmpty()) "${missing.size} added to favorites." else "Removed from favorites."
        clearSelection()
    }

    fun markSelectedWatched() {
        val picked = selectedItems()
        val mark = picked.any { library.progressOf(it.key)?.watched != true }
        picked.forEach { library.setWatched(it.key, mark) }
        message = "${picked.size} marked as " + if (mark) "watched." else "unwatched."
        clearSelection()
    }

    // ---------- backup ----------

    /** Favorites, progress, playlists, followed playlists, AI feedback and settings, as one JSON file. */
    fun exportBackup(uri: Uri) {
        viewModelScope.launch {
            message = try {
                val json = JSONObject()
                    .put("app", "ytd-studio-android")
                    .put("version", BuildConfig.VERSION_NAME)
                    .put("exportedAt", System.currentTimeMillis())
                    .put("settings", prefs.exportJson())
                    .put("library", library.exportJson())
                    .put("taste", Ai.taste.exportJson())
                withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openOutputStream(uri, "wt")!!.use { it.write(json.toString(2).toByteArray()) }
                }
                val s = library.state.value
                "Backup saved: ${s.favorites.size} favorites, ${s.playlists.size} playlists, ${s.saved.size} followed."
            } catch (e: Exception) {
                "Could not save the backup: " + (e.message ?: e.javaClass.simpleName)
            }
        }
    }

    /** Restore a backup made on this or another phone; it is merged into what is here. */
    fun importBackup(uri: Uri) {
        viewModelScope.launch {
            message = try {
                val text = withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
                }
                val json = JSONObject(text)
                if (json.optString("app") != "ytd-studio-android") throw IllegalArgumentException("That is not a YTD Studio for Android backup.")
                json.optJSONObject("settings")?.let { prefs.importJson(it) }
                json.optJSONObject("taste")?.let { Ai.taste.merge(it) }
                val s = json.optJSONObject("library")?.let { library.merge(it) } ?: library.state.value
                "Backup restored: ${s.favorites.size} favorites, ${s.playlists.size} playlists, ${s.saved.size} followed."
            } catch (e: Exception) {
                e.message ?: "Could not read that backup."
            }
        }
    }

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
