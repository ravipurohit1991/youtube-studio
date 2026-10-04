package com.ytdstudio.android.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.ytdstudio.android.R
import com.ytdstudio.android.ui.MainActivity
import com.ytdstudio.android.ui.PlayerActivity

object Notifications {
    const val CHANNEL_PROGRESS = "downloads"
    const val CHANNEL_DONE = "finished"
    const val ID_PROGRESS = 1

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_PROGRESS, context.getString(R.string.channel_downloads), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.channel_downloads_desc)
                setShowBadge(false)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_DONE, context.getString(R.string.channel_finished), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun progress(context: Context, title: String, text: String, percent: Int, indeterminate: Boolean, cancelAll: PendingIntent) =
        NotificationCompat.Builder(context, CHANNEL_PROGRESS)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title)
            .setContentText(text)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setSilent(true)
            .setProgress(100, percent.coerceIn(0, 100), indeterminate)
            .setContentIntent(openApp(context))
            .addAction(0, "Cancel all", cancelAll)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    fun finished(context: Context, jobId: String, title: String, ok: Boolean, message: String, uri: Uri?) {
        val intent = if (ok && uri != null) PlayerActivity.local(context, uri, title) else Intent(context, MainActivity::class.java)
        val pending = PendingIntent.getActivity(context, jobId.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val n = NotificationCompat.Builder(context, CHANNEL_DONE)
            .setSmallIcon(R.drawable.ic_stat_download)
            .setContentTitle(title)
            .setContentText(message)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(jobId.hashCode(), n)
        } catch (_: SecurityException) {
            // Notifications not allowed; the in-app queue still shows the result.
        }
    }
}
