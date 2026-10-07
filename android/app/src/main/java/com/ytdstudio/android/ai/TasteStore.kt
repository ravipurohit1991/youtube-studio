package com.ytdstudio.android.ai

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Discover feedback kept across sessions (ai-taste.json): thumbs up / down on suggestions, channels
 * to never show again, and recent requests. Ranking uses it as a soft preference; hidden channels
 * are filtered out outright.
 */
class TasteStore(context: Context) {
    private val file = File(context.filesDir, "ai-taste.json")
    private val stateFlow = MutableStateFlow(load())
    val state: StateFlow<TasteProfile> = stateFlow.asStateFlow()

    fun like(item: TasteItem) = vote(item, liked = true)

    fun dislike(item: TasteItem) = vote(item, liked = false)

    /** Forget a thumbs up or down. */
    fun clear(id: String) = edit { t -> t.copy(liked = t.liked.filterNot { it.id == id }, disliked = t.disliked.filterNot { it.id == id }) }

    fun block(channel: String) = edit { t ->
        val name = channel.trim()
        if (name.isEmpty()) t else t.copy(blockedChannels = listOf(name) + t.blockedChannels.filterNot { it.equals(name, ignoreCase = true) })
    }

    fun unblock(channel: String) = edit { t -> t.copy(blockedChannels = t.blockedChannels.filterNot { it.equals(channel, ignoreCase = true) }) }

    fun reset() = edit { TasteProfile() }

    fun rememberRequest(prompt: String) {
        val text = prompt.trim().take(200)
        if (text.isEmpty()) return
        edit { t -> t.copy(recent = (listOf(text) + t.recent.filterNot { it.equals(text, ignoreCase = true) }).take(MAX_RECENT)) }
    }

    fun exportJson(): JSONObject = toJson(stateFlow.value)

    /** Add feedback from a backup; what is here already wins. */
    fun merge(o: JSONObject) {
        val incoming = fromJson(o)
        edit { t ->
            t.copy(
                liked = (t.liked + incoming.liked.filter { x -> t.liked.none { it.id == x.id } }).take(MAX_ITEMS),
                disliked = (t.disliked + incoming.disliked.filter { x -> t.disliked.none { it.id == x.id } }).take(MAX_ITEMS),
                blockedChannels = (t.blockedChannels + incoming.blockedChannels).distinctBy { it.lowercase() },
                recent = (t.recent + incoming.recent).distinct().take(MAX_RECENT),
            )
        }
    }

    fun isBlocked(channel: String?): Boolean =
        channel != null && stateFlow.value.blockedChannels.any { it.equals(channel, ignoreCase = true) }

    private fun vote(item: TasteItem, liked: Boolean) = edit { t ->
        val clean = item.copy(title = item.title.take(200), channel = item.channel?.take(120), at = System.currentTimeMillis())
        val l = t.liked.filterNot { it.id == item.id }
        val d = t.disliked.filterNot { it.id == item.id }
        if (liked) t.copy(liked = (listOf(clean) + l).take(MAX_ITEMS), disliked = d)
        else t.copy(liked = l, disliked = (listOf(clean) + d).take(MAX_ITEMS))
    }

    private fun edit(transform: (TasteProfile) -> TasteProfile) {
        stateFlow.update(transform)
        try {
            file.writeText(toJson(stateFlow.value).toString())
        } catch (e: Exception) {
            Log.e(TAG, "save failed", e)
        }
    }

    private fun load(): TasteProfile = try {
        if (!file.exists()) TasteProfile() else fromJson(JSONObject(file.readText()))
    } catch (e: Exception) {
        Log.e(TAG, "load failed", e)
        TasteProfile()
    }

    private fun items(list: List<TasteItem>) = JSONArray().apply {
        list.forEach { put(JSONObject().put("id", it.id).put("title", it.title).put("channel", it.channel ?: JSONObject.NULL).put("at", it.at)) }
    }

    private fun toJson(t: TasteProfile) = JSONObject()
        .put("liked", items(t.liked))
        .put("disliked", items(t.disliked))
        .put("blockedChannels", JSONArray(t.blockedChannels))
        .put("recent", JSONArray(t.recent))

    private fun fromJson(o: JSONObject): TasteProfile {
        fun items(key: String): List<TasteItem> {
            val a = o.optJSONArray(key) ?: return emptyList()
            return (0 until a.length()).mapNotNull { i ->
                val x = a.optJSONObject(i) ?: return@mapNotNull null
                val id = x.optString("id", "")
                if (id.isEmpty()) null else TasteItem(id, x.optString("title", ""), if (x.isNull("channel")) null else x.optString("channel"), x.optLong("at"))
            }
        }
        fun strings(key: String): List<String> {
            val a = o.optJSONArray(key) ?: return emptyList()
            return (0 until a.length()).mapNotNull { a.optString(it, "").takeIf { s -> s.isNotEmpty() } }
        }
        return TasteProfile(items("liked"), items("disliked"), strings("blockedChannels"), strings("recent"))
    }

    companion object {
        private const val TAG = "TasteStore"
        private const val MAX_ITEMS = 200
        private const val MAX_RECENT = 12
    }
}
