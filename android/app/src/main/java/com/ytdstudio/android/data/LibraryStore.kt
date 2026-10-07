package com.ytdstudio.android.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Where playback stopped. [watched] is set once the end was reached (or by hand). */
data class WatchProgress(val positionMs: Long, val durationMs: Long, val updatedAt: Long, val watched: Boolean) {
    val fraction: Float get() = if (durationMs > 0) (positionMs.toFloat() / durationMs).coerceIn(0f, 1f) else 0f

    /** Worth offering under "Continue watching". */
    val inProgress: Boolean get() = !watched && positionMs > 5_000 && fraction < 0.95f
}

/** A playlist the user put together inside the app. [items] are library item keys, in play order. */
data class UserPlaylist(val id: String, val name: String, val items: List<String>, val createdAt: Long)

/**
 * A YouTube playlist the user wants to keep in sync: "Sync" downloads only the videos that were
 * added to it since the last time.
 */
data class SavedPlaylist(
    val id: String,
    val url: String,
    val title: String,
    val folder: String?,
    val mode: DownloadMode,
    val height: Int,
    val audioFormat: String,
    val thumbnail: String?,
    val knownIds: Set<String>,
    val lastSync: Long,
    val lastAdded: Int,
)

data class LibraryState(
    val favorites: Set<String> = emptySet(),
    val progress: Map<String, WatchProgress> = emptyMap(),
    val playlists: List<UserPlaylist> = emptyList(),
    val saved: List<SavedPlaylist> = emptyList(),
)

/** Favorites, watch progress, the user's own playlists and synced YouTube playlists, saved as JSON. */
class LibraryStore(context: Context) {
    private val file = File(context.filesDir, "library.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stateFlow = MutableStateFlow(load())
    private var saveJob: Job? = null

    val state: StateFlow<LibraryState> = stateFlow.asStateFlow()

    fun progressOf(key: String): WatchProgress? = stateFlow.value.progress[key]

    fun toggleFavorite(key: String) = edit { s ->
        s.copy(favorites = if (key in s.favorites) s.favorites - key else s.favorites + key)
    }

    fun saveProgress(key: String, positionMs: Long, durationMs: Long) = edit { s ->
        val done = durationMs > 0 && positionMs >= durationMs * 0.95
        val previous = s.progress[key]
        // Re-watching something already finished keeps it "watched" until it is marked unwatched.
        val watched = done || (previous?.watched == true && positionMs < 5_000)
        s.copy(progress = s.progress + (key to WatchProgress(positionMs, durationMs, System.currentTimeMillis(), watched)))
    }

    fun setWatched(key: String, watched: Boolean) = edit { s ->
        val previous = s.progress[key]
        val next = WatchProgress(if (watched) previous?.durationMs ?: 0 else 0, previous?.durationMs ?: 0, System.currentTimeMillis(), watched)
        s.copy(progress = s.progress + (key to next))
    }

    fun createPlaylist(name: String, items: List<String> = emptyList()): String {
        val id = UUID.randomUUID().toString()
        edit { s -> s.copy(playlists = s.playlists + UserPlaylist(id, name.trim().ifEmpty { "New playlist" }, items.distinct(), System.currentTimeMillis())) }
        return id
    }

    fun renamePlaylist(id: String, name: String) = editPlaylist(id) { it.copy(name = name.trim().ifEmpty { it.name }) }

    fun deletePlaylist(id: String) = edit { s -> s.copy(playlists = s.playlists.filterNot { it.id == id }) }

    fun addToPlaylist(id: String, keys: List<String>) = editPlaylist(id) { p -> p.copy(items = (p.items + keys).distinct()) }

    fun removeFromPlaylist(id: String, key: String) = editPlaylist(id) { p -> p.copy(items = p.items - key) }

    fun movePlaylistItem(id: String, from: Int, to: Int) = editPlaylist(id) { p ->
        if (from !in p.items.indices || to !in p.items.indices) p else {
            val list = p.items.toMutableList()
            list.add(to, list.removeAt(from))
            p.copy(items = list)
        }
    }

    fun upsertSaved(playlist: SavedPlaylist) = edit { s -> s.copy(saved = s.saved.filterNot { it.id == playlist.id } + playlist) }

    fun removeSaved(id: String) = edit { s -> s.copy(saved = s.saved.filterNot { it.id == id }) }

    fun markSynced(id: String, newIds: Collection<String>) = edit { s ->
        s.copy(saved = s.saved.map {
            if (it.id == id) it.copy(knownIds = it.knownIds + newIds, lastSync = System.currentTimeMillis(), lastAdded = newIds.size) else it
        })
    }

    /** A file was deleted: drop it everywhere. */
    fun forget(key: String) = edit { s ->
        s.copy(
            favorites = s.favorites - key,
            progress = s.progress - key,
            playlists = s.playlists.map { p -> if (key in p.items) p.copy(items = p.items - key) else p },
        )
    }

    /** Everything, for a backup file. */
    fun exportJson(): JSONObject = toJson(stateFlow.value)

    /**
     * Merge a backup in: favorites are combined, the newer progress wins per item, playlists and synced
     * playlists are added (same id: the incoming one gains any items it is missing).
     */
    fun merge(o: JSONObject): LibraryState {
        val incoming = fromJson(o)
        edit { s ->
            val progress = s.progress.toMutableMap()
            incoming.progress.forEach { (key, p) -> if ((progress[key]?.updatedAt ?: -1) < p.updatedAt) progress[key] = p }
            val playlists = s.playlists.toMutableList()
            incoming.playlists.forEach { p ->
                val i = playlists.indexOfFirst { it.id == p.id }
                if (i < 0) playlists += p else playlists[i] = playlists[i].copy(items = (playlists[i].items + p.items).distinct())
            }
            val saved = s.saved.toMutableList()
            incoming.saved.forEach { p ->
                val i = saved.indexOfFirst { it.id == p.id }
                if (i < 0) saved += p else saved[i] = saved[i].copy(knownIds = saved[i].knownIds + p.knownIds)
            }
            s.copy(favorites = s.favorites + incoming.favorites, progress = progress, playlists = playlists, saved = saved)
        }
        return stateFlow.value
    }

    private fun editPlaylist(id: String, transform: (UserPlaylist) -> UserPlaylist) = edit { s ->
        s.copy(playlists = s.playlists.map { if (it.id == id) transform(it) else it })
    }

    private fun edit(transform: (LibraryState) -> LibraryState) {
        stateFlow.update(transform)
        persist()
    }

    private fun persist() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(400)
            try {
                val tmp = File(file.parentFile, file.name + ".tmp")
                tmp.writeText(toJson(stateFlow.value).toString())
                tmp.renameTo(file)
            } catch (e: Exception) {
                Log.e(TAG, "save failed", e)
            }
        }
    }

    private fun load(): LibraryState = try {
        if (!file.exists()) LibraryState() else fromJson(JSONObject(file.readText()))
    } catch (e: Exception) {
        Log.e(TAG, "load failed", e)
        LibraryState()
    }

    private fun toJson(s: LibraryState) = JSONObject().apply {
        put("favorites", JSONArray(s.favorites.toList()))
        put("progress", JSONObject().apply {
            s.progress.forEach { (key, p) ->
                put(key, JSONObject().put("pos", p.positionMs).put("dur", p.durationMs).put("at", p.updatedAt).put("watched", p.watched))
            }
        })
        put("playlists", JSONArray().apply {
            s.playlists.forEach { p ->
                put(JSONObject().put("id", p.id).put("name", p.name).put("items", JSONArray(p.items)).put("createdAt", p.createdAt))
            }
        })
        put("saved", JSONArray().apply {
            s.saved.forEach { p ->
                put(
                    JSONObject()
                        .put("id", p.id).put("url", p.url).put("title", p.title).put("folder", p.folder)
                        .put("mode", p.mode.name).put("height", p.height).put("audioFormat", p.audioFormat)
                        .put("thumbnail", p.thumbnail).put("knownIds", JSONArray(p.knownIds.toList()))
                        .put("lastSync", p.lastSync).put("lastAdded", p.lastAdded),
                )
            }
        })
    }

    private fun fromJson(o: JSONObject): LibraryState {
        val progress = mutableMapOf<String, WatchProgress>()
        o.optJSONObject("progress")?.let { p ->
            p.keys().forEach { key ->
                p.optJSONObject(key)?.let {
                    progress[key] = WatchProgress(it.optLong("pos"), it.optLong("dur"), it.optLong("at"), it.optBoolean("watched"))
                }
            }
        }
        return LibraryState(
            favorites = o.optJSONArray("favorites").strings().toSet(),
            progress = progress,
            playlists = o.optJSONArray("playlists")?.objects().orEmpty().map {
                UserPlaylist(it.getString("id"), it.optString("name", "Playlist"), it.optJSONArray("items").strings(), it.optLong("createdAt"))
            },
            saved = o.optJSONArray("saved")?.objects().orEmpty().map {
                SavedPlaylist(
                    id = it.getString("id"),
                    url = it.getString("url"),
                    title = it.optString("title", "Playlist"),
                    folder = it.optStringOrNull("folder"),
                    mode = runCatching { DownloadMode.valueOf(it.getString("mode")) }.getOrDefault(DownloadMode.VIDEO),
                    height = it.optInt("height", 1080),
                    audioFormat = it.optString("audioFormat", "m4a"),
                    thumbnail = it.optStringOrNull("thumbnail"),
                    knownIds = it.optJSONArray("knownIds").strings().toSet(),
                    lastSync = it.optLong("lastSync"),
                    lastAdded = it.optInt("lastAdded"),
                )
            },
        )
    }

    companion object {
        private const val TAG = "LibraryStore"
    }
}

private fun JSONArray?.strings(): List<String> =
    if (this == null) emptyList() else (0 until length()).mapNotNull { i -> optString(i).takeIf { it.isNotEmpty() } }
