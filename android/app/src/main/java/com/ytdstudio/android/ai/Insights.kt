package com.ytdstudio.android.ai

import android.util.Log
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.engine.Engine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** Video insights (summary, questions) from captions, and library organization. */
object Insights {
    private const val TAG = "Insights"
    private const val MAX_ORGANIZE = 300

    /** What the AI reads about one video. */
    class VideoContext(
        val source: InsightSource,
        val description: String,
        val chapters: List<Pair<Double, String>>,
        /** "[mm:ss] text" lines, one per ~30 seconds, or "" when the video has no captions. */
        val transcript: String,
    )

    private val cache = object : LinkedHashMap<String, VideoContext>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, VideoContext>?): Boolean = size > 40
    }

    suspend fun videoContext(url: String): VideoContext {
        synchronized(cache) { cache[url] }?.let { return it }
        val info = Engine.infoJson(url)
        if (info.optString("_type") == "playlist") throw IllegalStateException("That is a playlist. Open a single video to summarize it.")
        val id = info.optString("id", url)
        synchronized(cache) { cache[id] }?.let { return it }
        val track = AiCore.pickCaptionTrack(info)
        var transcript = ""
        if (track != null) {
            val dir = File(Ai.appContext.cacheDir, "captions-" + UUID.randomUUID())
            try {
                val file = Engine.downloadCaptions(info.optString("webpage_url", url), track.lang, track.auto, dir)
                if (file != null) transcript = withContext(Dispatchers.Default) { AiCore.compactTranscript(AiCore.parseVtt(file.readText())) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                Log.w(TAG, "captions failed", e)
            } finally {
                dir.deleteRecursively()
            }
        }
        val chapters = info.optJSONArray("chapters")?.let { a ->
            (0 until a.length()).mapNotNull { i ->
                val c = a.optJSONObject(i) ?: return@mapNotNull null
                val title = c.optString("title", "")
                if (title.isEmpty()) null else c.optDouble("start_time", 0.0) to title
            }
        }.orEmpty()
        val context = VideoContext(
            source = InsightSource(
                videoId = id,
                title = info.optString("title", "Untitled"),
                channel = str(info, "channel") ?: str(info, "uploader"),
                duration = info.optDouble("duration", Double.NaN).takeIf { !it.isNaN() },
                language = if (transcript.isNotEmpty()) track?.lang else null,
                autoCaptions = transcript.isNotEmpty() && track?.auto == true,
            ),
            description = (str(info, "description") ?: "").take(4000),
            chapters = chapters,
            transcript = transcript,
        )
        synchronized(cache) {
            cache[id] = context
            cache[url] = context
        }
        return context
    }

    private fun str(o: JSONObject, key: String): String? = if (o.isNull(key)) null else o.optString(key, "").takeIf { it.isNotEmpty() }

    /** The video as one block of prompt text. */
    fun contextText(ctx: VideoContext): String {
        val parts = mutableListOf(
            "Title: " + ctx.source.title,
            "Channel: " + (ctx.source.channel ?: "unknown"),
            "Length: " + (ctx.source.duration?.let { AiCore.clock(it) } ?: "unknown"),
        )
        if (ctx.chapters.isNotEmpty()) parts += "Chapters:\n" + ctx.chapters.joinToString("\n") { "[" + AiCore.clock(it.first) + "] " + it.second }
        if (ctx.description.isNotEmpty()) parts += "Description:\n" + ctx.description
        parts += if (ctx.transcript.isNotEmpty()) {
            "Transcript (" + (if (ctx.source.autoCaptions) "automatic captions, may contain recognition errors" else "captions") +
                ", language " + ctx.source.language + "):\n" + ctx.transcript
        } else {
            "Transcript: not available for this video. Work from the title, chapters and description, and say so."
        }
        return parts.joinToString("\n\n")
    }

    class Events(
        val onStage: (String) -> Unit = {},
        val onSource: (InsightSource) -> Unit = {},
        val onDelta: (String) -> Unit = {},
    )

    suspend fun summarize(url: String, events: Events): String {
        Ollama.requireReady()
        events.onStage("Reading the transcript…")
        val ctx = videoContext(url)
        events.onSource(ctx.source)
        events.onStage("Summarizing…")
        return Ollama.chat(
            listOf(ChatMessage("system", AiCore.SUMMARY_SYSTEM), ChatMessage("user", contextText(ctx))),
            Ollama.Options(temperature = 0.3, longContext = true, onDelta = events.onDelta, onThinking = { events.onStage("Thinking…") }),
        )
    }

    suspend fun ask(url: String, question: String, history: List<ChatMessage>, events: Events): String {
        Ollama.requireReady()
        val q = question.trim()
        require(q.isNotEmpty()) { "Type a question first." }
        events.onStage("Reading the transcript…")
        val ctx = videoContext(url)
        events.onSource(ctx.source)
        events.onStage("Thinking…")
        val past = history.takeLast(8).map { ChatMessage(it.role, it.content.take(6000)) }
        return Ollama.chat(
            listOf(ChatMessage("system", AiCore.ASK_SYSTEM + "\n\n" + contextText(ctx))) + past + ChatMessage("user", q),
            Ollama.Options(temperature = 0.3, longContext = true, onDelta = events.onDelta, onThinking = { events.onStage("Thinking…") }),
        )
    }

    /** Let the model sort the library into themed playlists. Nothing is created here. */
    suspend fun organize(onStage: (String) -> Unit): List<OrganizeGroup> {
        Ollama.requireReady()
        onStage("Reading your library…")
        val items: List<LibraryItem> = withContext(Dispatchers.IO) { MediaLibrary.query(Ai.appContext) }
            .sortedByDescending { it.dateAdded }
            .take(MAX_ORGANIZE)
        if (items.size < 6) throw IllegalStateException("Download a few more videos first: there is not enough in your library to sort into playlists.")
        val existing = Ai.library.state.value.playlists.map { it.name }
        val lines = items.mapIndexed { i, item ->
            "${i + 1}. " + item.title.take(120) + " | " + (if (item.isVideo) "video" else "audio") + " | " +
                (if (item.durationMs > 0) AiCore.clock(item.durationMs / 1000.0) else "?")
        }
        val parts = mutableListOf<String>()
        if (existing.isNotEmpty()) parts += "Existing playlists (do not reuse these names): " + existing.joinToString(", ")
        parts += "Library:\n" + lines.joinToString("\n")
        onStage("Grouping ${items.size} items into playlists…")
        val raw = Ollama.chatJson(
            listOf(ChatMessage("system", AiCore.ORGANIZE_SYSTEM), ChatMessage("user", parts.joinToString("\n\n"))),
            AiCore.organizeSchema(),
            temperature = 0.3,
            longContext = true,
            onThinking = { onStage("Thinking about how to group them…") },
        )
        val used = HashSet<Int>()
        val taken = existing.map { it.lowercase() }.toMutableSet()
        val groups = mutableListOf<OrganizeGroup>()
        val array = raw.optJSONArray("groups")
        if (array != null) {
            for (g in 0 until array.length()) {
                val group = array.optJSONObject(g) ?: continue
                val name = group.optString("name", "").trim().take(60)
                if (name.isEmpty() || name.lowercase() in taken) continue
                val keys = mutableListOf<String>()
                val numbers = group.optJSONArray("items")
                if (numbers != null) {
                    for (n in 0 until numbers.length()) {
                        val index = Math.round(numbers.optDouble(n, -1.0)).toInt() - 1
                        if (index in items.indices && used.add(index)) keys += items[index].key
                    }
                }
                if (keys.size < 2) continue
                taken += name.lowercase()
                groups += OrganizeGroup(name, group.optString("description", "").trim().take(160), keys)
            }
        }
        if (groups.isEmpty()) throw IllegalStateException("The model did not come up with usable playlists. Try again or pick another model.")
        return groups
    }
}
