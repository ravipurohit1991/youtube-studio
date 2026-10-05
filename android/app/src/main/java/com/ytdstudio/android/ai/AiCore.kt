package com.ytdstudio.android.ai

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.Base64

/**
 * The parts of the AI features that are plain logic: caption parsing, YouTube's search filter
 * encoding, lenient JSON replies, and the prompts. Same behavior as the desktop app (src/main/ai).
 */
object AiCore {
    const val CLOUD_HOST = "https://ollama.com"
    const val LOCAL_HOST = "http://localhost:11434"

    /** Roughly 12k tokens of transcript: plenty for a summary, and fits small local context windows too. */
    private const val MAX_TRANSCRIPT_CHARS = 48_000

    // ---------- hosts ----------

    fun normalizeHost(raw: String): String = raw.trim().trimEnd('/').ifEmpty { CLOUD_HOST }

    fun isCloudHost(host: String): Boolean = try {
        val name = URI(host).host ?: ""
        name == "ollama.com" || name.endsWith(".ollama.com")
    } catch (e: Exception) {
        false
    }

    /**
     * Where the key may go: Ollama Cloud, any HTTPS server, or this device. Never over plain HTTP to
     * another machine, where it would cross the network in clear text.
     */
    fun keyAllowedFor(host: String): Boolean = try {
        val uri = URI(host)
        when (uri.scheme) {
            "https" -> true
            "http" -> uri.host in setOf("localhost", "127.0.0.1", "[::1]", "::1")
            else -> false
        }
    } catch (e: Exception) {
        false
    }

    // ---------- captions ----------

    data class Cue(val start: Double, val text: String)

    fun clock(seconds: Double): String {
        val total = seconds.toLong().coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
    }

    private fun parseTime(value: String): Double =
        value.trim().split(':').fold(0.0) { sum, part -> sum * 60 + (part.trim().toDoubleOrNull() ?: 0.0) }

    private fun decodeEntities(text: String): String = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")

    /**
     * WebVTT to cues. YouTube's automatic captions "roll": each cue repeats the previous line and adds
     * a new one, so a line already emitted is skipped.
     */
    fun parseVtt(vtt: String): List<Cue> {
        val cues = mutableListOf<Cue>()
        var last = ""
        vtt.replace("\r", "").split(Regex("\n\n+")).forEach { block ->
            val lines = block.split('\n')
            val timing = lines.indexOfFirst { it.contains("-->") }
            if (timing < 0) return@forEach
            val start = parseTime(lines[timing].substringBefore("-->"))
            lines.drop(timing + 1).forEach { raw ->
                val text = decodeEntities(raw.replace(Regex("<[^>]+>"), "")).replace(Regex("\\s+"), " ").trim()
                if (text.isEmpty() || text == last) return@forEach
                last = text
                cues += Cue(start, text)
            }
        }
        return cues
    }

    /** Cues grouped into ~30 second "[mm:ss] ..." lines, thinned evenly when the video is very long. */
    fun compactTranscript(cues: List<Cue>): String {
        if (cues.isEmpty()) return ""
        val total = cues.sumOf { it.text.length + 1 }
        val window = when {
            total > MAX_TRANSCRIPT_CHARS * 2 -> 90
            total > MAX_TRANSCRIPT_CHARS -> 60
            else -> 30
        }
        val groups = mutableListOf<Pair<Double, StringBuilder>>()
        cues.forEach { cue ->
            val current = groups.lastOrNull()
            if (current != null && cue.start - current.first < window) current.second.append(' ').append(cue.text)
            else groups += cue.start to StringBuilder(cue.text)
        }
        val share = maxOf(80, MAX_TRANSCRIPT_CHARS / groups.size - 10)
        return groups.joinToString("\n") { (start, text) ->
            "[" + clock(start) + "] " + (if (text.length > share) text.substring(0, share) + "…" else text.toString())
        }
    }

    data class CaptionTrack(val lang: String, val auto: Boolean)

    /** Which caption track to use: uploaded English, then the original spoken language, then anything. */
    fun pickCaptionTrack(info: JSONObject): CaptionTrack? {
        val manual = info.optJSONObject("subtitles")?.keys()?.asSequence()?.filter { it != "live_chat" }?.toList().orEmpty()
        val auto = info.optJSONObject("automatic_captions")?.keys()?.asSequence()?.toList().orEmpty()
        val spoken = info.optString("language", "").takeIf { !info.isNull("language") }.orEmpty().lowercase()
        fun isEn(k: String) = k == "en" || k.startsWith("en-")
        manual.firstOrNull(::isEn)?.let { return CaptionTrack(it, false) }
        if (spoken.isNotEmpty()) {
            manual.firstOrNull { it == spoken || it.startsWith("$spoken-") }?.let { return CaptionTrack(it, false) }
            (auto.firstOrNull { it == "$spoken-orig" } ?: auto.firstOrNull { it == spoken })?.let { return CaptionTrack(it, true) }
        }
        auto.firstOrNull { it.endsWith("-orig") }?.let { return CaptionTrack(it, true) }
        manual.firstOrNull()?.let { return CaptionTrack(it, false) }
        auto.firstOrNull { it == "en" }?.let { return CaptionTrack(it, true) }
        return auto.firstOrNull()?.let { CaptionTrack(it, true) }
    }

    // ---------- YouTube search ----------

    /**
     * YouTube's search filters ("sp" parameter) are a small protobuf: field 1 = sort, field 2 = filters
     * { 1: upload date, 2: type (1 = video), 3: duration }. Always restricting to videos keeps channels
     * and playlists out of the results.
     */
    fun searchParam(sort: DiscoverSort, recency: DiscoverRecency, length: DiscoverLength): String {
        val filters = mutableListOf<Int>()
        if (recency != DiscoverRecency.ANY) filters += listOf(0x08, recency.code)
        filters += listOf(0x10, 0x01)
        if (length != DiscoverLength.ANY) filters += listOf(0x18, length.code)
        val bytes = mutableListOf<Int>()
        if (sort.code != 0) bytes += listOf(0x08, sort.code)
        bytes += listOf(0x12, filters.size)
        bytes += filters
        return Base64.getEncoder().encodeToString(ByteArray(bytes.size) { bytes[it].toByte() })
    }

    fun searchUrl(query: String, sort: DiscoverSort, recency: DiscoverRecency, length: DiscoverLength): String =
        "https://www.youtube.com/results?search_query=" + encode(query) + "&sp=" + encode(searchParam(sort, recency, length))

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    /** Interleave lists (one from each, then the next from each...) so every search is represented. */
    fun <T> roundRobin(groups: List<List<T>>, limit: Int): List<T> {
        val out = mutableListOf<T>()
        var row = 0
        while (out.size < limit) {
            var added = false
            for (group in groups) {
                if (row < group.size && out.size < limit) {
                    out += group[row]
                    added = true
                }
            }
            if (!added) break
            row++
        }
        return out
    }

    // ---------- JSON replies ----------

    /** Pull the JSON object out of a reply (tolerates code fences and chatter around it). */
    fun parseJsonReply(text: String): JSONObject {
        val cleaned = text.replace(Regex("```(?:json)?", RegexOption.IGNORE_CASE), "").trim()
        return try {
            JSONObject(cleaned)
        } catch (e: Exception) {
            val start = cleaned.indexOf('{')
            val end = cleaned.lastIndexOf('}')
            if (start >= 0 && end > start) {
                try {
                    return JSONObject(cleaned.substring(start, end + 1))
                } catch (_: Exception) {
                }
            }
            throw IllegalStateException("The model did not return valid JSON.")
        }
    }

    // ---------- schemas ----------

    private fun obj(vararg props: Pair<String, JSONObject>, required: List<String> = props.map { it.first }): JSONObject =
        JSONObject().put("type", "object").put("properties", JSONObject().apply { props.forEach { put(it.first, it.second) } }).put("required", JSONArray(required))

    private fun type(name: String) = JSONObject().put("type", name)
    private fun enumOf(values: List<String>) = JSONObject().put("type", "string").put("enum", JSONArray(values))
    private fun arrayOf(items: JSONObject) = JSONObject().put("type", "array").put("items", items)

    val SORT_NAMES = listOf("relevance", "date", "views", "rating")
    val RECENCY_NAMES = listOf("any", "today", "week", "month", "year")

    fun planSchema(): JSONObject = obj(
        "intent" to type("string"),
        "queries" to arrayOf(obj("q" to type("string"), "sort" to enumOf(SORT_NAMES))),
        "recency" to enumOf(RECENCY_NAMES),
        "minMinutes" to type("number"),
        "maxMinutes" to type("number"),
        "allowShorts" to type("boolean"),
    )

    fun rankSchema(): JSONObject = obj("picks" to arrayOf(obj("i" to type("integer"), "score" to type("integer"), "why" to type("string"))))

    fun organizeSchema(): JSONObject =
        obj("groups" to arrayOf(obj("name" to type("string"), "description" to type("string"), "items" to arrayOf(type("integer")))))

    // ---------- prompts (same wording as the desktop app) ----------

    const val MAX_RESULTS = 24

    const val PLAN_SYSTEM = """You are the search planner inside YTD Studio, a personal YouTube app. Your job: turn what the user wants into YouTube searches that surface the best videos for them, so they do not depend on YouTube's engagement-driven recommendations.

Return JSON with:
- intent: one short sentence (max 20 words) restating what they want, in second person ("You want ...").
- queries: 3 to 6 YouTube searches. Make them diverse: different phrasings, sub-topics, formats (tutorial, documentary, talk, live session...), and well-known high quality creators or channels in this niche when you know them. Write each like a person types into YouTube: 2 to 7 words, no quotes, no operators, no hashtags. Use the language the content should be in.
- For each query, sort: "date" when they want new/latest/recent things, "views" for popular or classic picks, "rating" rarely, otherwise "relevance".
- recency: "today", "week", "month" or "year" only when the request is clearly about a time window, else "any".
- minMinutes / maxMinutes: length bounds implied by the request (e.g. "quick" -> maxMinutes 10, "full course" or "long" -> minMinutes 40, "podcast" -> minMinutes 20). Use 0 for no bound.
- allowShorts: true only if they want YouTube Shorts / very short clips.

Follow-up adjustments, when present, refine the original request: apply all of them, the most recent wins on conflicts. Use the taste profile, when present, to pick angles and creators they will like, but the explicit request always wins."""

    val RANK_SYSTEM = """You are the ranking step of a personal YouTube recommender. You get a request and numbered search results. Pick the videos this person should actually watch.

Score each pick 0-100 for fit. Reward: directly on topic, substance over hype, credible or well-known creators, a format and length that match the request, and the taste profile. Penalize: clickbait or misleading titles, reaction videos, reuploads, compilations and low-effort AI slop (unless asked for), off-topic results, near-duplicates of a better pick, and anything resembling what they disliked.

Return JSON {"picks": [{"i": <number of the result>, "score": <0-100>, "why": "<one specific sentence, max 18 words, on what makes this one fit>"}]}, best first, at most $MAX_RESULTS picks, only scores of 40 or more. Never invent numbers that are not in the list."""

    const val SUMMARY_SYSTEM = """You help someone decide whether a YouTube video is worth their time and get its value fast. You are given the video's title, description, chapters and transcript with [mm:ss] timestamps.

Write the summary in English, in exactly this shape and nothing else:

## TL;DW
Two or three sentences: what the video actually delivers (the substance, not the hype).

## Key moments
- [mm:ss] One line per important point, in order, 5 to 8 bullets. Use only timestamps that appear in the transcript or chapters.

## Worth watching?
One or two sentences: who it is for, how solid the information is, whether the title over-promises, and any sponsor segment or skippable part with its timestamp.

Formatting: plain text, "## " headings and "- " bullets only, **bold** sparingly. No preamble, no closing remarks. If there is no transcript, say so in the TL;DW and work from the description and chapters."""

    const val ASK_SYSTEM = """You answer questions about one YouTube video, using its transcript (with [mm:ss] timestamps), description and chapters given below.

- Be direct and concise. Cite where in the video things are said as [mm:ss] so the viewer can jump there.
- If the video does not cover something, say so plainly. You may add general knowledge when it helps, but mark it as not from the video.
- Answer in the language of the question. Plain text; "- " bullets and **bold** are fine."""

    const val ORGANIZE_SYSTEM = """You organize someone's downloaded videos and music into playlists they would actually use. You get a numbered list (number. title | video/audio | length).

Make 3 to 10 playlists grouped by topic, genre, mood, series or purpose (e.g. "Deep work focus music", "Rust from zero", "Late-night jazz"). Each needs at least 3 items. An item goes in at most one playlist; skip items that fit nowhere. Names: short and clear, max 40 characters, no emoji, not the same as an existing playlist. description: one short line on what ties it together.

Return JSON {"groups": [{"name": "...", "description": "...", "items": [numbers]}]}. Only use numbers from the list."""

    /** "[1:02:03]" / "[02:03]" to seconds. */
    fun parseStamp(stamp: String): Double = parseTime(stamp.trim('[', ']'))

    /** Inline timestamps the models write, e.g. [02:15] or [1:02:15]. */
    val STAMP = Regex("\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)]")
}
