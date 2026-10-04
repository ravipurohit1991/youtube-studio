package com.ytdstudio.android.engine

import android.content.Context
import android.util.Log
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.PlaylistEntry
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.data.VideoMeta
import com.ytdstudio.android.data.objects
import com.ytdstudio.android.data.optStringOrNull
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.concurrent.atomic.AtomicInteger

/**
 * yt-dlp on Android.
 *
 * There is no Windows-style "download the exe" here: Android apps cannot run arbitrary downloaded
 * executables from their data folder (W^X since Android 10). The youtubedl-android library solves
 * this by shipping CPython, ffmpeg/ffprobe and QuickJS as native libraries (`lib*.so`) inside the
 * APK. Android installs those into the app's nativeLibraryDir, which *is* executable. On first launch
 * the library unpacks the Python standard library and ffmpeg's shared libs into app storage.
 *
 * yt-dlp itself is pure Python (a zipapp), so it is just a data file that python runs. That is what
 * lets the app replace it with the newest release from GitHub at runtime, exactly like the desktop
 * app keeps its yt-dlp.exe current.
 */
object Engine {
    sealed interface State {
        data object Preparing : State
        data class Updating(val message: String) : State
        data class Ready(val version: String?, val notice: String? = null) : State
        data class Failed(val message: String) : State
    }

    private const val TAG = "Engine"
    private const val PROGRESS_PREFIX = "@@P "
    private const val UPDATE_INTERVAL_MS = 12L * 60 * 60 * 1000

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stateFlow = MutableStateFlow<State>(State.Preparing)
    private val toolLock = Mutex()
    private val running = AtomicInteger(0)
    private lateinit var appContext: Context
    private lateinit var prefs: Prefs

    val state: StateFlow<State> = stateFlow.asStateFlow()
    val busyDownloads: Int get() = running.get()

    fun start(context: Context, prefs: Prefs) {
        appContext = context.applicationContext
        this.prefs = prefs
        scope.launch { initialize() }
    }

    fun retryInit() {
        if (stateFlow.value is State.Failed) scope.launch { initialize() }
    }

    private suspend fun initialize() {
        stateFlow.value = State.Preparing
        try {
            toolLock.withLock {
                // Unpacks python + ffmpeg on first run (a few seconds), instant afterwards.
                YoutubeDL.init(appContext)
                FFmpeg.init(appContext)
            }
        } catch (e: Throwable) {
            Log.e(TAG, "init failed", e)
            stateFlow.value = State.Failed("Could not prepare yt-dlp: " + (e.message ?: e.javaClass.simpleName))
            return
        }
        stateFlow.value = State.Ready(currentVersion())
        val stale = System.currentTimeMillis() - prefs.lastYtdlpCheck > UPDATE_INTERVAL_MS
        if (prefs.settings.value.autoUpdateYtdlp && stale) updateYtdlp(silent = true)
    }

    /** Wait for init/update to settle, then throw if the engine is unusable. */
    suspend fun awaitReady() {
        val settled = state.first { it is State.Ready || it is State.Failed }
        if (settled is State.Failed) throw IllegalStateException(settled.message)
    }

    private suspend fun currentVersion(): String? = withContext(Dispatchers.IO) {
        YoutubeDL.versionName(appContext)?.takeIf { it.isNotBlank() } ?: try {
            val req = YoutubeDLRequest(emptyList<String>()).addOption("--version")
            YoutubeDL.execute(req, null, null).out.trim().lines().lastOrNull()
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Fetch the newest yt-dlp release from GitHub (YouTube changes often, an old yt-dlp is the most
     * common cause of failures). Refused while downloads are running, since it swaps the file they use.
     */
    fun updateYtdlp(silent: Boolean = false) {
        scope.launch {
            if (stateFlow.value is State.Preparing || stateFlow.value is State.Updating) return@launch
            if (running.get() > 0) {
                if (!silent) stateFlow.value = State.Ready(currentVersion(), "Finish or cancel running downloads first, then update.")
                return@launch
            }
            toolLock.withLock {
                stateFlow.value = State.Updating("Checking for a newer yt-dlp...")
                val notice = try {
                    val status = YoutubeDL.updateYoutubeDL(appContext, YoutubeDL.UpdateChannel.STABLE)
                    prefs.lastYtdlpCheck = System.currentTimeMillis()
                    if (status == YoutubeDL.UpdateStatus.DONE) "yt-dlp updated." else "yt-dlp is up to date."
                } catch (e: Exception) {
                    Log.w(TAG, "update failed", e)
                    "Could not check for yt-dlp updates (offline?). Using the current copy."
                }
                stateFlow.value = State.Ready(currentVersion(), if (silent && notice.endsWith("up to date.")) null else notice)
            }
        }
    }

    fun clearNotice() {
        val s = stateFlow.value
        if (s is State.Ready && s.notice != null) stateFlow.value = s.copy(notice = null)
    }

    suspend fun probe(url: String): VideoMeta = withContext(Dispatchers.IO) {
        awaitReady()
        val req = YoutubeDLRequest(url)
            .addOption("--ignore-config")
            .addOption("--no-warnings")
            .addOption("--no-progress")
            .addOption("--dump-single-json")
            .addOption("--flat-playlist")
            .addOption("--playlist-end", 300)
        val text = try {
            YoutubeDL.execute(req, null, null).out
        } catch (e: YoutubeDLException) {
            throw IllegalStateException(cleanError(e.message ?: "") .ifBlank { "yt-dlp could not read that link." })
        }
        val json = text.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("{") }
            ?: throw IllegalStateException("yt-dlp returned no data for that link.")
        parseMeta(url, JSONObject(json))
    }

    private fun parseMeta(url: String, info: JSONObject): VideoMeta {
        val type = info.optStringOrNull("_type")
        if (type == "playlist" || type == "multi_video") {
            val entries = info.optJSONArray("entries")?.objects().orEmpty().map { e ->
                val id = e.optStringOrNull("id") ?: ""
                var entryUrl = e.optStringOrNull("webpage_url") ?: e.optStringOrNull("url") ?: id
                if (!entryUrl.startsWith("http")) entryUrl = "https://www.youtube.com/watch?v=$entryUrl"
                PlaylistEntry(
                    id = id,
                    url = entryUrl,
                    title = e.optStringOrNull("title") ?: id,
                    uploader = e.optStringOrNull("uploader") ?: e.optStringOrNull("channel"),
                    duration = e.optDoubleOrNull("duration"),
                    thumbnail = thumbOf(e),
                )
            }.filter { it.url.isNotBlank() }
            return VideoMeta(
                url = url,
                id = info.optStringOrNull("id"),
                title = info.optStringOrNull("title") ?: "Playlist",
                uploader = info.optStringOrNull("uploader") ?: info.optStringOrNull("channel"),
                duration = null,
                thumbnail = thumbOf(info) ?: entries.firstOrNull()?.thumbnail,
                viewCount = null,
                heights = emptyList(),
                isPlaylist = true,
                entries = entries,
            )
        }
        val heights = info.optJSONArray("formats")?.objects().orEmpty()
            .filter { (it.optStringOrNull("vcodec") ?: "none") != "none" && it.optInt("height", 0) > 0 }
            .map { it.optInt("height") }
            .distinct()
            .sortedDescending()
        return VideoMeta(
            url = info.optStringOrNull("webpage_url") ?: url,
            id = info.optStringOrNull("id"),
            title = info.optStringOrNull("title") ?: "Untitled",
            uploader = info.optStringOrNull("uploader") ?: info.optStringOrNull("channel"),
            duration = info.optDoubleOrNull("duration"),
            thumbnail = thumbOf(info),
            viewCount = if (info.has("view_count") && !info.isNull("view_count")) info.optLong("view_count") else null,
            heights = heights,
            isPlaylist = false,
            entries = emptyList(),
        )
    }

    private fun thumbOf(info: JSONObject): String? {
        info.optStringOrNull("thumbnail")?.let { return it }
        return info.optJSONArray("thumbnails")?.objects()?.mapNotNull { it.optStringOrNull("url") }?.lastOrNull()
    }

    /**
     * Same format strategy as the desktop app with ffmpeg present: H.264 + AAC first so the file
     * plays everywhere, VP9/AV1 only when nothing else exists at that size.
     */
    fun formatSelector(mode: DownloadMode, height: Int, audioFormat: String): String {
        if (mode == DownloadMode.AUDIO) {
            // Pick the source that needs no re-encode for the chosen format.
            return when (audioFormat) {
                "m4a" -> "bestaudio[ext=m4a]/bestaudio/best"
                "opus" -> "bestaudio[acodec=opus]/bestaudio/best"
                else -> "bestaudio/best"
            }
        }
        val limit = if (height > 0) "[height<=$height]" else ""
        return "bestvideo$limit[vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo$limit[ext=mp4]+bestaudio[ext=m4a]/" +
            "bestvideo$limit+bestaudio/best$limit/best"
    }

    class Progress(
        val downloaded: Long,
        val total: Long,
        val speedBytes: Double?,
        val etaSeconds: Double?,
    )

    interface Listener {
        fun onProgress(p: Progress)
        /** A new step started. [processing] = post-processing (merge/convert); [newStream] = a new file began downloading. */
        fun onStage(stage: String, processing: Boolean, newStream: Boolean)
        fun onLog(line: String)
    }

    /**
     * Run one download into [workDir] and return the finished file. Blocks the calling thread;
     * call from Dispatchers.IO. Throws [YoutubeDL.CanceledException] when [cancel] was called.
     */
    suspend fun download(
        jobId: String,
        url: String,
        mode: DownloadMode,
        height: Int,
        audioFormat: String,
        workDir: File,
        listener: Listener,
    ): File = withContext(Dispatchers.IO) {
        awaitReady()
        workDir.mkdirs()
        val pathFile = File(workDir.parentFile, "$jobId.path")
        pathFile.delete()
        val req = YoutubeDLRequest(url)
            .addOption("--ignore-config")
            .addOption("--no-colors")
            .addOption("--newline")
            .addOption("--progress")
            .addOption(
                "--progress-template",
                "download:$PROGRESS_PREFIX%(progress.downloaded_bytes)s %(progress.total_bytes)s " +
                    "%(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s",
            )
            .addOption("--concurrent-fragments", 4)
            .addOption("--retries", 10)
            .addOption("--fragment-retries", 10)
            .addOption("--no-playlist")
            .addOption("--no-mtime")
            .addOption("--force-overwrites")
            .addOption("-P", workDir.absolutePath)
            // Keep names well under Android's 255-byte limit.
            .addOption("-o", "%(title).150B [%(id)s].%(ext)s")
            .addOption("-f", formatSelector(mode, height, audioFormat))
            .addOption("--embed-metadata")
        if (mode == DownloadMode.AUDIO) {
            req.addOption("-x")
                .addOption("--audio-format", audioFormat)
                .addOption("--audio-quality", "0")
                .addOption("--embed-thumbnail")
        } else {
            req.addOption("--merge-output-format", "mp4")
        }
        // --print-to-file takes two values, which the options map cannot hold, and the library
        // appends its own options after ours. Raw commands always go last, right before the URL.
        req.addCommands(listOf("--print-to-file", "after_move:filepath", pathFile.absolutePath, "--"))

        running.incrementAndGet()
        val parser = LineParser(mode, listener)
        val response = try {
            YoutubeDL.execute(req, jobId, false) { _, _, line -> parser.handle(line) }
        } catch (e: YoutubeDLException) {
            throw IllegalStateException(cleanError(e.message ?: "").ifBlank { "yt-dlp failed." })
        } finally {
            running.decrementAndGet()
        }
        val reported = pathFile.takeIf { it.exists() }?.readLines()?.map { it.trim() }?.lastOrNull { it.isNotEmpty() }
        pathFile.delete()
        val file = reported?.let { File(it) }?.takeIf { it.isFile }
            ?: workDir.walkTopDown().filter { it.isFile && it.extension.lowercase() in MEDIA_EXT }.maxByOrNull { it.length() }
            ?: throw IllegalStateException(
                "Downloaded, but the output file could not be found. " + cleanError(response.err),
            )
        file
    }

    /** Turns yt-dlp's output into progress numbers and human readable steps (same rules as the desktop app). */
    private class LineParser(private val mode: DownloadMode, private val listener: Listener) {
        private var streams = 0
        private var lastStage: String? = null

        fun handle(raw: String) {
            val line = raw.trim()
            if (line.isEmpty()) return
            if (line.startsWith(PROGRESS_PREFIX)) {
                val parts = line.removePrefix(PROGRESS_PREFIX).split(' ')
                fun num(i: Int) = parts.getOrNull(i)?.toDoubleOrNull()
                val total = num(1) ?: num(2) ?: 0.0
                listener.onProgress(Progress((num(0) ?: 0.0).toLong(), total.toLong(), num(3), num(4)))
                return
            }
            listener.onLog(line)
            PROCESSING_STAGES.firstOrNull { line.startsWith(it.first) }?.let {
                stage(it.second, processing = true)
                return
            }
            if (line.startsWith("[download] Destination:")) {
                streams += 1
                val label = when {
                    mode == DownloadMode.AUDIO -> "Downloading audio"
                    streams == 1 -> "Downloading video"
                    else -> "Downloading audio track"
                }
                lastStage = label
                listener.onStage(label, processing = false, newStream = true)
                return
            }
            when {
                Regex("^\\[youtube[^\\]]*\\].*(Downloading|Extracting)").containsMatchIn(line) -> stage("Fetching video info")
                line.startsWith("[info]") && line.contains("Downloading") && line.contains("format") -> stage("Starting download")
                line.startsWith("[hlsnative]") || line.startsWith("[dashsegments]") -> stage("Downloading stream fragments")
            }
        }

        private fun stage(label: String, processing: Boolean = false) {
            if (label == lastStage) return
            lastStage = label
            listener.onStage(label, processing, newStream = false)
        }
    }

    /** What the player needs to stream a video without saving it. */
    data class Track(val url: String, val headers: Map<String, String>, val isHls: Boolean)
    data class StreamSource(val title: String, val uploader: String?, val video: Track?, val audio: Track?, val label: String)

    /**
     * Resolve playable URLs (plus the headers yt-dlp says they need) for in-app streaming.
     * Plain HTTPS files are preferred; HLS is only a fallback since ExoPlayer can play it too.
     */
    suspend fun resolveStream(url: String, height: Int, audioOnly: Boolean): StreamSource = withContext(Dispatchers.IO) {
        awaitReady()
        val limit = if (height > 0) "[height<=$height]" else ""
        val selector = if (audioOnly) {
            "bestaudio[protocol=https][ext=m4a]/bestaudio[protocol=https]/bestaudio"
        } else {
            "bestvideo$limit[protocol=https][vcodec^=avc1]+bestaudio[protocol=https][ext=m4a]/" +
                "bestvideo$limit[protocol=https]+bestaudio[protocol=https]/best$limit[protocol=https]/best$limit/best"
        }
        val req = YoutubeDLRequest(url)
            .addOption("--ignore-config")
            .addOption("--no-warnings")
            .addOption("--no-playlist")
            .addOption("-f", selector)
            .addOption("--dump-json")
        val text = try {
            YoutubeDL.execute(req, null, null).out
        } catch (e: YoutubeDLException) {
            throw IllegalStateException(cleanError(e.message ?: "").ifBlank { "Could not get a playable stream." })
        }
        val info = JSONObject(text.lineSequence().map { it.trim() }.lastOrNull { it.startsWith("{") }
            ?: throw IllegalStateException("yt-dlp returned no stream data."))
        val requested = info.optJSONArray("requested_formats")?.objects().orEmpty()
        val parts = requested.ifEmpty { listOf(info) }
        fun track(o: JSONObject): Track? {
            val u = o.optStringOrNull("url") ?: return null
            val headers = mutableMapOf<String, String>()
            o.optJSONObject("http_headers")?.let { h -> h.keys().forEach { k -> h.optStringOrNull(k)?.let { headers[k] = it } } }
            return Track(u, headers, (o.optStringOrNull("protocol") ?: "").contains("m3u8"))
        }
        val hasVideo = { o: JSONObject -> (o.optStringOrNull("vcodec") ?: "none") != "none" }
        val videoPart = parts.firstOrNull(hasVideo)
        val audioPart = parts.firstOrNull { !hasVideo(it) }
        val label = parts.joinToString(" + ") { o ->
            val h = o.optInt("height", 0)
            if (hasVideo(o) && h > 0) "${h}p ${o.optString("ext")}" else (o.optStringOrNull("ext") ?: "") + " audio"
        }
        StreamSource(
            title = info.optStringOrNull("title") ?: url,
            uploader = info.optStringOrNull("uploader") ?: info.optStringOrNull("channel"),
            video = videoPart?.let(::track),
            // Muxed formats carry their own audio; audio-only requests have no video part.
            audio = (if (videoPart == null) parts.firstOrNull() else audioPart)?.let(::track),
            label = label,
        )
    }

    fun cancel(jobId: String): Boolean = YoutubeDL.destroyProcessById(jobId)

    fun cleanError(raw: String): String {
        val lines = raw.lines()
            .map { it.replace(Regex("^\\s*ERROR:\\s*", RegexOption.IGNORE_CASE), "").trim() }
            .filter { it.isNotEmpty() && !it.startsWith("WARNING") && !it.startsWith("Deprecated") }
        return lines.takeLast(3).joinToString(" | ")
    }

    private val PROCESSING_STAGES = listOf(
        "[Merger]" to "Merging video and audio",
        "[ExtractAudio]" to "Converting audio",
        "[VideoConvertor]" to "Converting video",
        "[VideoRemuxer]" to "Remuxing video",
        "[Fixup" to "Fixing up the file",
        "[Metadata]" to "Writing metadata",
        "[EmbedThumbnail]" to "Embedding cover art",
        "[ThumbnailsConvertor]" to "Converting cover art",
        "[MoveFiles]" to "Moving file into place",
    )

    val MEDIA_EXT = setOf("mp4", "mkv", "webm", "mov", "m4v", "3gp", "mp3", "m4a", "opus", "ogg", "oga", "wav", "flac", "aac")
}

private fun JSONObject.optDoubleOrNull(key: String): Double? =
    if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
