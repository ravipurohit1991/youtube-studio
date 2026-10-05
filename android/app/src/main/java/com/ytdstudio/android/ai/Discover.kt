package com.ytdstudio.android.ai

import android.util.Log
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.engine.Engine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Discover: your own recommendation algorithm. The model turns a plain-language request (plus your
 * taste profile) into several YouTube searches with real filters, yt-dlp runs them, and the model
 * then ranks every candidate for this one person, with a reason for each pick.
 */
object Discover {
    private const val TAG = "Discover"
    private const val MAX_QUERIES = 6
    private const val MAX_CANDIDATES = 70

    private class Profile(val text: String, val usable: Boolean, val ownedIds: Set<String>)

    private class Plan(
        val intent: String,
        val queries: List<DiscoverQuery>,
        val recency: DiscoverRecency,
        val minMinutes: Double,
        val maxMinutes: Double,
        val allowShorts: Boolean,
    )

    private class Candidate(val hit: Engine.SearchHit, val query: String)

    private class Pick(val index: Int, val score: Int?, val why: String?)

    suspend fun run(req: DiscoverRequest, report: (String) -> Unit): DiscoverResult {
        val model = Ollama.requireReady()
        val started = System.currentTimeMillis()
        val prompt = req.prompt.trim()
        report("Reading your taste profile…")
        val profile = buildProfile(req.personalize)
        if (prompt.isEmpty() && !profile.usable) {
            throw IllegalStateException(
                if (req.personalize) "Nothing to personalize from yet: your library is empty. Describe what you want to watch instead."
                else "Describe what you want to watch, or turn on Personalize to get picks based on your library.",
            )
        }

        var web = emptyList<WebResult>()
        if (req.useWeb && prompt.isNotEmpty()) {
            report("Looking it up on the web…")
            web = try {
                Ollama.webSearch(prompt, 5)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w(TAG, "web search failed", e)
                emptyList()
            }
        }

        var plan = try {
            planSearches(req, profile, web, report)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Planning is a nicety: with a request in hand, a plain search still works.
            if (prompt.isEmpty()) throw e
            Log.w(TAG, "planning failed", e)
            Plan("", emptyList(), DiscoverRecency.ANY, 0.0, 0.0, false)
        }
        if (plan.queries.isEmpty()) {
            if (prompt.isEmpty()) throw IllegalStateException("The model did not suggest any searches. Try again or describe what you want.")
            plan = Plan(plan.intent, listOf(DiscoverQuery(prompt.take(100), DiscoverSort.RELEVANCE)), plan.recency, plan.minMinutes, plan.maxMinutes, plan.allowShorts)
        }

        val (queries, groups) = runSearches(plan, req, report)
        val disliked = Ai.taste.state.value.disliked.map { it.id }.toSet()
        val seen = HashSet<String>()
        val filtered = groups.map { group ->
            group.filter { c ->
                val h = c.hit
                if (!seen.add(h.id)) return@filter false
                if (h.id in req.exclude || h.id in disliked || h.id in profile.ownedIds) return@filter false
                if (h.live || Ai.taste.isBlocked(h.channel)) return@filter false
                if (h.short && !plan.allowShorts) return@filter false
                val d = h.duration
                if (d != null) {
                    if (plan.minMinutes > 0 && d < plan.minMinutes * 60) return@filter false
                    if (plan.maxMinutes > 0 && d > plan.maxMinutes * 60) return@filter false
                }
                true
            }
        }
        val candidates = AiCore.roundRobin(filtered, MAX_CANDIDATES)
        if (candidates.isEmpty()) throw IllegalStateException("YouTube returned nothing new for these searches. Try loosening the filters or rephrasing.")

        var picks = try {
            rank(req, plan, candidates, profile, report)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "ranking failed", e)
            emptyList()
        }
        val unranked = picks.isEmpty()
        if (unranked) picks = candidates.indices.take(AiCore.MAX_RESULTS).map { Pick(it, null, null) }
        val videos = picks.map { p ->
            val c = candidates[p.index]
            DiscoverVideo(
                id = c.hit.id,
                url = "https://www.youtube.com/watch?v=" + c.hit.id,
                title = c.hit.title,
                channel = c.hit.channel,
                duration = c.hit.duration,
                views = c.hit.views,
                thumbnail = "https://i.ytimg.com/vi/" + c.hit.id + "/mqdefault.jpg",
                score = p.score,
                reason = p.why?.takeIf { it.isNotBlank() },
                query = c.query,
            )
        }
        if (prompt.isNotEmpty()) Ai.taste.rememberRequest(prompt)
        return DiscoverResult(
            intent = plan.intent.ifBlank { if (prompt.isNotEmpty()) "Results for \"$prompt\"" else "Picks based on your library" },
            queries = queries,
            videos = videos,
            candidates = candidates.size,
            webSources = web.filter { it.url.isNotBlank() }.map { (it.title.ifBlank { it.url }) to it.url },
            model = model,
            elapsedMs = System.currentTimeMillis() - started,
            unranked = unranked,
        )
    }

    // ---------- taste profile ----------

    private suspend fun buildProfile(personalize: Boolean): Profile {
        val items: List<LibraryItem> = try {
            withContext(Dispatchers.IO) { MediaLibrary.query(Ai.appContext) }
        } catch (e: Exception) {
            Log.w(TAG, "library scan failed", e)
            emptyList()
        }
        val owned = items.mapNotNull { it.videoId }.toSet()
        val taste = Ai.taste.state.value
        val blocked = if (taste.blockedChannels.isNotEmpty()) "Never suggest these channels: " + taste.blockedChannels.joinToString(", ") else ""
        if (!personalize) return Profile(blocked, false, owned)
        val state = Ai.library.state.value
        val unique = items.sortedByDescending { it.dateAdded }.distinctBy { it.videoId ?: it.key }
        fun title(i: LibraryItem) = i.title.take(110)
        val favorites = unique.filter { it.key in state.favorites }.take(12).map(::title)
        val finished = unique.filter { state.progress[it.key]?.watched == true }.take(10).map(::title)
        val recent = unique.take(25).map(::title)
        val folders = unique.mapNotNull { it.folder }.distinct().take(10)
        val lines = mutableListOf<String>()
        if (folders.isNotEmpty()) lines += "Playlists they downloaded: " + folders.joinToString(", ")
        if (favorites.isNotEmpty()) lines += "Favorites:\n- " + favorites.joinToString("\n- ")
        if (finished.isNotEmpty()) lines += "Watched to the end:\n- " + finished.joinToString("\n- ")
        if (recent.isNotEmpty()) lines += "Recently downloaded:\n- " + recent.joinToString("\n- ")
        fun label(t: TasteItem) = t.title.take(110) + (t.channel?.let { " ($it)" } ?: "")
        if (taste.liked.isNotEmpty()) lines += "Suggestions they liked:\n- " + taste.liked.take(15).joinToString("\n- ", transform = ::label)
        if (taste.disliked.isNotEmpty()) lines += "Suggestions they disliked (steer away from similar):\n- " + taste.disliked.take(15).joinToString("\n- ", transform = ::label)
        if (taste.recent.isNotEmpty()) lines += "Things they asked for recently: " + taste.recent.take(6).joinToString(", ") { "\"$it\"" }
        val usable = lines.isNotEmpty()
        if (blocked.isNotEmpty()) lines += blocked
        return Profile(lines.joinToString("\n\n"), usable, owned)
    }

    // ---------- plan ----------

    private suspend fun planSearches(req: DiscoverRequest, profile: Profile, web: List<WebResult>, report: (String) -> Unit): Plan {
        val parts = mutableListOf<String>()
        val prompt = req.prompt.trim()
        parts += if (prompt.isNotEmpty()) "Request: $prompt" else
            "Request: none given. Suggest fresh videos they will probably love, based only on the taste profile below: mostly closely related topics and creators, plus one or two adjacent discoveries. Do not repeat titles they already have."
        val refinements = req.refinements.map { it.trim() }.filter { it.isNotEmpty() }
        if (refinements.isNotEmpty()) parts += "Follow-up adjustments (oldest first):\n- " + refinements.joinToString("\n- ")
        if (req.avoid.isNotBlank()) parts += "Always avoid: " + req.avoid.trim()
        if (req.length != DiscoverLength.ANY) parts += "Length filter chosen in the app: " + req.length.name.lowercase() + " (already applied to every search)."
        if (req.recency != DiscoverRecency.ANY) parts += "Upload date filter chosen in the app: " + req.recency.name.lowercase() + " (already applied to every search)."
        if (web.isNotEmpty()) parts += "Fresh context from a web search (use it for names, releases and current events, ignore if irrelevant):\n" +
            web.joinToString("\n") { "- " + it.title + ": " + it.content.take(280) }
        if (profile.text.isNotEmpty()) parts += "Taste profile:\n" + profile.text
        report("Planning searches…")
        val raw = Ollama.chatJson(
            listOf(ChatMessage("system", AiCore.PLAN_SYSTEM), ChatMessage("user", parts.joinToString("\n\n"))),
            AiCore.planSchema(),
            temperature = 0.5,
            onThinking = { report("Thinking about what you want…") },
        )
        val seen = HashSet<String>()
        val queries = mutableListOf<DiscoverQuery>()
        val list = raw.optJSONArray("queries")
        if (list != null) {
            for (i in 0 until list.length()) {
                val q = list.optJSONObject(i) ?: continue
                val text = q.optString("q", "").replace(Regex("[\"#]"), "").trim().take(100)
                if (text.length < 2 || !seen.add(text.lowercase())) continue
                queries += DiscoverQuery(text, sortOf(q.optString("sort", "")))
            }
        }
        return Plan(
            intent = raw.optString("intent", "").trim().take(240),
            queries = queries.take(MAX_QUERIES),
            recency = recencyOf(raw.optString("recency", "any")),
            minMinutes = raw.optDouble("minMinutes", 0.0).takeIf { !it.isNaN() && it > 0 } ?: 0.0,
            maxMinutes = raw.optDouble("maxMinutes", 0.0).takeIf { !it.isNaN() && it > 0 } ?: 0.0,
            allowShorts = raw.optBoolean("allowShorts", false),
        )
    }

    private fun sortOf(name: String): DiscoverSort = when (name) {
        "date" -> DiscoverSort.DATE
        "views" -> DiscoverSort.VIEWS
        "rating" -> DiscoverSort.RATING
        else -> DiscoverSort.RELEVANCE
    }

    private fun recencyOf(name: String): DiscoverRecency =
        DiscoverRecency.entries.firstOrNull { it.name.equals(name, ignoreCase = true) } ?: DiscoverRecency.ANY

    // ---------- search ----------

    private suspend fun runSearches(plan: Plan, req: DiscoverRequest, report: (String) -> Unit): Pair<List<DiscoverQuery>, List<List<Candidate>>> = coroutineScope {
        val recency = if (req.recency != DiscoverRecency.ANY) req.recency else plan.recency
        val perQuery = if (plan.queries.size <= 3) 20 else 15
        val gate = Semaphore(3)
        var done = 0
        val errors = mutableListOf<String>()
        report("Searching YouTube (0/${plan.queries.size})…")
        val results = plan.queries.map { query ->
            async {
                gate.withPermit {
                    val hits = try {
                        Engine.searchVideos(AiCore.searchUrl(query.q, query.sort, recency, req.length), perQuery).map { Candidate(it, query.q) }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        Log.w(TAG, "search failed: " + query.q, e)
                        synchronized(errors) { errors += e.message ?: "search failed" }
                        emptyList()
                    }
                    synchronized(errors) { done++ }
                    report("Searching YouTube ($done/${plan.queries.size})…")
                    hits
                }
            }
        }.awaitAll()
        if (results.all { it.isEmpty() } && errors.isNotEmpty()) throw IllegalStateException("YouTube search failed: " + errors.first())
        plan.queries.mapIndexed { i, q -> q.copy(found = results[i].size) } to results
    }

    // ---------- rank ----------

    private fun minutes(seconds: Double?): String = when {
        seconds == null || seconds <= 0 -> "?"
        seconds < 60 -> "${seconds.toInt()}s"
        else -> "${Math.round(seconds / 60)} min"
    }

    private fun count(n: Long?): String = when {
        n == null -> "?"
        n >= 1_000_000 -> "%.1fM".format(n / 1_000_000.0)
        n >= 1_000 -> "${n / 1000}K"
        else -> n.toString()
    }

    private suspend fun rank(req: DiscoverRequest, plan: Plan, candidates: List<Candidate>, profile: Profile, report: (String) -> Unit): List<Pick> {
        report("Ranking ${candidates.size} videos for you…")
        val list = candidates.mapIndexed { i, c ->
            val h = c.hit
            val snippet = h.description?.let { " | " + it.replace(Regex("\\s+"), " ").take(140) } ?: ""
            "${i + 1}. " + h.title.take(140) + " | " + (h.channel ?: "?") + " | " + minutes(h.duration) + " | " + count(h.views) + " views" + snippet
        }.joinToString("\n")
        val parts = mutableListOf("Request: " + plan.intent.ifBlank { req.prompt.trim().ifBlank { "videos they will love, based on their taste" } })
        val refinements = req.refinements.filter { it.isNotBlank() }
        if (refinements.isNotEmpty()) parts += "Adjustments: " + refinements.joinToString("; ")
        if (req.avoid.isNotBlank()) parts += "Always avoid: " + req.avoid.trim()
        if (profile.text.isNotEmpty()) parts += "Taste profile:\n" + profile.text
        parts += "Results (number. title | channel | length | views | snippet):\n$list"
        val raw: JSONObject = Ollama.chatJson(
            listOf(ChatMessage("system", AiCore.RANK_SYSTEM), ChatMessage("user", parts.joinToString("\n\n"))),
            AiCore.rankSchema(),
            temperature = 0.2,
            onThinking = { report("Weighing ${candidates.size} videos…") },
        )
        val used = HashSet<Int>()
        val picks = mutableListOf<Pick>()
        val array = raw.optJSONArray("picks") ?: return emptyList()
        for (i in 0 until array.length()) {
            val p = array.optJSONObject(i) ?: continue
            val index = Math.round(p.optDouble("i", -1.0)).toInt() - 1
            val score = p.optDouble("score", Double.NaN)
            if (index !in candidates.indices || score.isNaN() || !used.add(index)) continue
            picks += Pick(index, Math.round(score).toInt().coerceIn(0, 100), p.optString("why", "").trim().take(200))
        }
        return picks.sortedByDescending { it.score ?: 0 }.take(AiCore.MAX_RESULTS)
    }
}
