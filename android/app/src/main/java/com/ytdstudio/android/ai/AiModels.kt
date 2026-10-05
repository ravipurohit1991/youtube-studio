package com.ytdstudio.android.ai

/** Types shared by the AI features. Mirrors src/shared/types.ts of the desktop app. */

data class AiModel(val name: String, val size: Long?, val parameterSize: String?)

/** What the UI may know about the AI setup. The API key itself never leaves [KeyVault]. */
data class AiStatus(
    val host: String,
    val model: String,
    val hasKey: Boolean,
    val keyHint: String?,
    val isCloud: Boolean,
) {
    /** A model is picked and (for the cloud) a key is stored. */
    val ready: Boolean get() = model.isNotBlank() && (!isCloud || hasKey)
}

enum class DiscoverLength(val label: String, val code: Int) { ANY("Any length", 0), SHORT("< 4 min", 1), MEDIUM("4-20 min", 3), LONG("20+ min", 2) }

enum class DiscoverRecency(val label: String, val code: Int) { ANY("Any time", 0), TODAY("Today", 2), WEEK("This week", 3), MONTH("This month", 4), YEAR("This year", 5) }

enum class DiscoverSort(val code: Int) { RELEVANCE(0), RATING(1), DATE(2), VIEWS(3) }

data class DiscoverRequest(
    /** What to look for. Empty means "for you": derive it from the taste profile. */
    val prompt: String,
    /** Follow-ups ("shorter", "less clickbait"), oldest first. */
    val refinements: List<String> = emptyList(),
    /** Video ids already shown, left out of the results ("more"). */
    val exclude: Set<String> = emptySet(),
    val length: DiscoverLength = DiscoverLength.ANY,
    val recency: DiscoverRecency = DiscoverRecency.ANY,
    val avoid: String = "",
    val personalize: Boolean = true,
    val useWeb: Boolean = false,
)

data class DiscoverQuery(val q: String, val sort: DiscoverSort, val found: Int = 0)

data class DiscoverVideo(
    val id: String,
    val url: String,
    val title: String,
    val channel: String?,
    val duration: Double?,
    val views: Long?,
    val thumbnail: String,
    /** 0-100: how well the model thinks it fits; null when unranked. */
    val score: Int?,
    val reason: String?,
    val query: String,
)

data class DiscoverResult(
    val intent: String,
    val queries: List<DiscoverQuery>,
    val videos: List<DiscoverVideo>,
    val candidates: Int,
    val webSources: List<Pair<String, String>>,
    val model: String,
    val elapsedMs: Long,
    val unranked: Boolean,
)

/** The video a summary or answer is based on. */
data class InsightSource(
    val videoId: String,
    val title: String,
    val channel: String?,
    val duration: Double?,
    /** Caption language used, or null when there is no transcript. */
    val language: String?,
    val autoCaptions: Boolean,
)

data class OrganizeGroup(val name: String, val description: String, val keys: List<String>)

data class TasteItem(val id: String, val title: String, val channel: String?, val at: Long = System.currentTimeMillis())

/** Discover feedback kept across sessions. */
data class TasteProfile(
    val liked: List<TasteItem> = emptyList(),
    val disliked: List<TasteItem> = emptyList(),
    val blockedChannels: List<String> = emptyList(),
    val recent: List<String> = emptyList(),
)
