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
import java.io.File
import java.util.UUID

/** Download queue and history, persisted as JSON in app storage (same idea as the desktop jobs file). */
class JobStore(context: Context) {
    private val file = File(context.filesDir, "jobs.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val state = MutableStateFlow(load())
    private var saveJob: Job? = null

    val jobs: StateFlow<List<DownloadJob>> = state.asStateFlow()

    private fun load(): List<DownloadJob> = try {
        if (!file.exists()) emptyList() else {
            JSONArray(file.readText()).objects().map { DownloadJob.fromJson(it) }.map { job ->
                // A job that was running when the process died is kept as paused: yt-dlp continues
                // from the partial file in its work folder when it is resumed.
                if (job.status.isActive || job.status == JobStatus.QUEUED) {
                    job.copy(status = JobStatus.PAUSED, stage = "Paused when the app closed", speed = null, eta = null)
                } else job
            }
        }
    } catch (e: Exception) {
        Log.e(TAG, "load failed", e)
        emptyList()
    }

    fun get(id: String): DownloadJob? = state.value.firstOrNull { it.id == id }

    fun addAll(reqs: List<DownloadRequest>): List<DownloadJob> = reqs.map { add(it) }

    private var lastCreated = 0L

    /** Strictly increasing, so a playlist queued in one go downloads in playlist order. */
    @Synchronized
    private fun nextCreatedAt(): Long {
        lastCreated = maxOf(System.currentTimeMillis(), lastCreated + 1)
        return lastCreated
    }

    fun add(req: DownloadRequest): DownloadJob {
        val job = DownloadJob(
            id = UUID.randomUUID().toString(),
            url = req.url,
            mode = req.mode,
            height = req.height,
            audioFormat = req.audioFormat,
            title = req.title ?: req.url,
            uploader = req.uploader,
            thumbnail = req.thumbnail,
            duration = req.duration,
            videoId = req.videoId,
            folder = req.folder,
            playlistIndex = req.playlistIndex,
            clipStart = req.clipStart,
            clipEnd = req.clipEnd,
            sponsorBlock = req.sponsorBlock,
            createdAt = nextCreatedAt(),
        )
        state.update { listOf(job) + it }
        persist()
        return job
    }

    fun update(id: String, persistNow: Boolean = true, transform: (DownloadJob) -> DownloadJob) {
        state.update { list -> list.map { if (it.id == id) transform(it) else it } }
        if (persistNow) persist()
    }

    fun retry(id: String) = update(id) {
        if (it.status.isActive) it else it.copy(
            status = JobStatus.QUEUED, percent = 0f, downloadedBytes = 0, totalBytes = 0, speed = null, eta = null,
            error = null, stage = "Waiting in queue", log = "", outputUri = null, outputName = null, finishedAt = null, createdAt = nextCreatedAt(),
        )
    }

    /** A waiting job stays in the list but is skipped until it is resumed. */
    fun pause(id: String) = update(id) {
        if (it.status == JobStatus.QUEUED || it.status.isActive) it.copy(status = JobStatus.PAUSED, stage = "Paused", speed = null, eta = null) else it
    }

    fun resume(id: String) = update(id) {
        if (it.status == JobStatus.PAUSED) it.copy(status = JobStatus.QUEUED, stage = "Waiting in queue", error = null) else it
    }

    /** Put a waiting (or paused) job at the front of the queue. */
    fun prioritize(id: String) {
        val first = state.value.filter { it.status == JobStatus.QUEUED }.minOfOrNull { it.createdAt } ?: System.currentTimeMillis()
        update(id) {
            if (it.status == JobStatus.QUEUED || it.status == JobStatus.PAUSED) {
                it.copy(status = JobStatus.QUEUED, stage = "Waiting in queue", createdAt = minOf(first, it.createdAt) - 1)
            } else it
        }
    }

    fun resumeAll(): Int {
        val paused = state.value.filter { it.status == JobStatus.PAUSED }
        paused.forEach { resume(it.id) }
        return paused.size
    }

    fun retryFailed(): Int {
        val failed = state.value.filter { it.status == JobStatus.FAILED }.sortedBy { it.createdAt }
        failed.forEach { retry(it.id) }
        return failed.size
    }

    fun remove(id: String) {
        state.update { list -> list.filterNot { it.id == id } }
        persist()
    }

    fun clearFinished() {
        state.update { list -> list.filterNot { it.status.isFinished } }
        persist()
    }

    /** Oldest queued job first, like a real queue. */
    fun nextQueued(): DownloadJob? = state.value.filter { it.status == JobStatus.QUEUED }.minByOrNull { it.createdAt }

    private fun persist() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(500)
            try {
                val arr = JSONArray()
                state.value.take(MAX_HISTORY).forEach { arr.put(it.toJson()) }
                val tmp = File(file.parentFile, file.name + ".tmp")
                tmp.writeText(arr.toString())
                tmp.renameTo(file)
            } catch (e: Exception) {
                Log.e(TAG, "save failed", e)
            }
        }
    }

    companion object {
        private const val TAG = "JobStore"
        private const val MAX_HISTORY = 300
    }
}
