package com.ytdstudio.android.service

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.yausername.youtubedl_android.YoutubeDL
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.data.DownloadJob
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.ui.formatBytes
import com.ytdstudio.android.ui.formatDuration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.sample
import kotlinx.coroutines.launch
import java.io.File
import java.util.Collections

/**
 * Runs the download queue as a foreground service, so downloads keep going with the screen off or
 * the app in the background, and shows their progress in a notification.
 */
class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val running = Collections.synchronizedMap(mutableMapOf<String, Job>())
    private val canceled = Collections.synchronizedSet(mutableSetOf<String>())
    private var wakeLock: PowerManager.WakeLock? = null
    private var inForeground = false
    private val store get() = YtdApp.instance.jobs

    override fun onBind(intent: Intent?): IBinder? = null

    @OptIn(FlowPreview::class)
    override fun onCreate() {
        super.onCreate()
        scope.launch {
            store.jobs.sample(700).collect { updateNotification(it) }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        when (intent?.action) {
            ACTION_CANCEL -> intent.getStringExtra(EXTRA_JOB_ID)?.let { cancelJob(it) }
            ACTION_CANCEL_ALL -> store.jobs.value.filter { it.status == JobStatus.QUEUED || it.status.isActive }.forEach { cancelJob(it.id) }
        }
        pump()
        stopIfIdle()
        return START_NOT_STICKY
    }

    private fun goForeground() {
        if (inForeground) return
        val notification = Notifications.progress(this, "YTD Studio", "Preparing download...", 0, true, cancelAllIntent())
        ServiceCompat.startForeground(this, Notifications.ID_PROGRESS, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        inForeground = true
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ytdstudio:download")
                .apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
        }
    }

    private fun cancelJob(id: String) {
        val job = store.get(id) ?: return
        if (job.status == JobStatus.QUEUED) {
            store.update(id) { it.copy(status = JobStatus.CANCELED, stage = "Stopped", error = null, finishedAt = System.currentTimeMillis()) }
            return
        }
        canceled += id
        Engine.cancel(id)
        running[id]?.cancel()
    }

    @Synchronized
    private fun pump() {
        val limit = YtdApp.instance.prefs.settings.value.concurrentDownloads
        while (running.size < limit) {
            val next = store.nextQueued() ?: break
            store.update(next.id) { it.copy(status = JobStatus.DOWNLOADING, stage = "Contacting YouTube", error = null) }
            val job = scope.launch(Dispatchers.IO, start = CoroutineStart.LAZY) { run(next) }
            running[next.id] = job
            job.invokeOnCompletion {
                running.remove(next.id)
                canceled.remove(next.id)
                pump()
                stopIfIdle()
            }
            job.start()
        }
    }

    private suspend fun run(job: DownloadJob) {
        val work = File(filesDir, "work/${job.id}")
        var lastWrite = 0L
        try {
            val file = Engine.download(job.id, job.url, job.mode, job.height, job.audioFormat, work, filePrefix = job.filePrefix, listener = object : Engine.Listener {
                override fun onProgress(p: Engine.Progress) {
                    val now = System.currentTimeMillis()
                    if (now - lastWrite < 300) return
                    lastWrite = now
                    store.update(job.id, persistNow = false) {
                        val pct = if (p.total > 0) (p.downloaded * 100f / p.total).coerceIn(0f, 99.4f) else it.percent
                        it.copy(
                            percent = pct,
                            downloadedBytes = p.downloaded,
                            totalBytes = if (p.total > 0) p.total else it.totalBytes,
                            speed = p.speedBytes?.takeIf { s -> s > 0 }?.let { s -> formatBytes(s.toLong()) + "/s" } ?: it.speed,
                            eta = p.etaSeconds?.takeIf { e -> e > 0 }?.let { e -> formatDuration(e) } ?: it.eta,
                        )
                    }
                }

                override fun onStage(stage: String, processing: Boolean, newStream: Boolean) {
                    store.update(job.id, persistNow = false) {
                        when {
                            processing -> it.copy(status = JobStatus.PROCESSING, stage = stage, percent = maxOf(it.percent, 99f), speed = null, eta = null)
                            newStream -> it.copy(stage = stage, percent = 0f, downloadedBytes = 0, totalBytes = 0)
                            else -> it.copy(stage = stage)
                        }
                    }
                }

                override fun onLog(line: String) {
                    store.update(job.id, persistNow = false) { it.copy(log = (it.log + line + "\n").takeLast(4000)) }
                }
            })
            if (job.id in canceled) throw YoutubeDL.CanceledException()
            val video = MediaLibrary.isVideoFile(file.name)
            val place = MediaLibrary.folderLabel(video) + (MediaLibrary.safeFolder(job.folder)?.let { "/$it" } ?: "")
            store.update(job.id) { it.copy(status = JobStatus.SAVING, stage = "Saving to $place", percent = 99.5f) }
            val uri = MediaLibrary.save(this, file, job.folder)
            store.update(job.id) {
                it.copy(
                    status = JobStatus.COMPLETED, stage = "Saved to $place", percent = 100f, speed = null, eta = null,
                    outputUri = uri.toString(), outputName = file.name, totalBytes = file.length(), downloadedBytes = file.length(),
                    title = if (it.title == it.url) MediaLibrary.cleanTitle(file.name) else it.title,
                    finishedAt = System.currentTimeMillis(),
                )
            }
            Notifications.finished(this, job.id, store.get(job.id)?.title ?: job.title, true, "Saved to $place. Tap to play.", uri, video)
        } catch (e: Throwable) {
            val wasCanceled = job.id in canceled || e is YoutubeDL.CanceledException || e is kotlinx.coroutines.CancellationException
            if (!wasCanceled) Log.e(TAG, "download failed", e)
            store.update(job.id) {
                it.copy(
                    status = if (wasCanceled) JobStatus.CANCELED else JobStatus.FAILED,
                    stage = if (wasCanceled) "Stopped" else "Failed",
                    error = if (wasCanceled) null else (e.message ?: e.javaClass.simpleName),
                    speed = null, eta = null, finishedAt = System.currentTimeMillis(),
                )
            }
            if (!wasCanceled) Notifications.finished(this, job.id, job.title, false, "Download failed: " + (e.message ?: "unknown error").take(120), null)
        } finally {
            work.deleteRecursively()
        }
    }

    private fun updateNotification(jobs: List<DownloadJob>) {
        if (!inForeground) return
        val active = jobs.filter { it.status.isActive }
        val queued = jobs.count { it.status == JobStatus.QUEUED }
        val lead = active.firstOrNull() ?: return
        val extra = (active.size - 1 + queued).takeIf { it > 0 }?.let { " · $it more" } ?: ""
        val text = buildString {
            append(lead.stage ?: "Downloading")
            if (lead.status == JobStatus.DOWNLOADING && lead.percent > 0) append(" · ${lead.percent.toInt()}%")
            lead.speed?.let { append(" · $it") }
            append(extra)
        }
        val indeterminate = lead.status != JobStatus.DOWNLOADING || lead.percent <= 0f
        val n = Notifications.progress(this, lead.title, text, lead.percent.toInt(), indeterminate, cancelAllIntent())
        try {
            androidx.core.app.NotificationManagerCompat.from(this).notify(Notifications.ID_PROGRESS, n)
        } catch (_: SecurityException) {
        }
    }

    private fun cancelAllIntent(): PendingIntent = PendingIntent.getService(
        this, 1, Intent(this, DownloadService::class.java).setAction(ACTION_CANCEL_ALL),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun stopIfIdle() {
        if (running.isNotEmpty() || store.nextQueued() != null) return
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        inForeground = false
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        stopSelf()
    }

    // Android 15 caps dataSync services at 6 hours a day; stop cleanly instead of being killed.
    override fun onTimeout(startId: Int, fgsType: Int) {
        store.jobs.value.filter { it.status == JobStatus.QUEUED || it.status.isActive }.forEach { cancelJob(it.id) }
        stopIfIdle()
    }

    override fun onDestroy() {
        scope.cancel()
        wakeLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    companion object {
        private const val TAG = "DownloadService"
        const val ACTION_CANCEL = "com.ytdstudio.android.CANCEL"
        const val ACTION_CANCEL_ALL = "com.ytdstudio.android.CANCEL_ALL"
        const val EXTRA_JOB_ID = "jobId"

        /** Start (or poke) the service so it picks up newly queued jobs. */
        fun kick(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
        }

        fun cancel(context: Context, jobId: String) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, DownloadService::class.java).setAction(ACTION_CANCEL).putExtra(EXTRA_JOB_ID, jobId),
            )
        }
    }
}
