package com.ytdstudio.android.service

import android.app.PendingIntent
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.ui.PlayerActivity
import com.ytdstudio.android.ui.StreamSourceFactory

/**
 * Owns the player, so audio (and, if enabled, video) keeps playing with the screen off or the app
 * in the background, with the usual media notification and lock-screen controls. The player
 * screen is just a client of this session. Also records where you stopped, for "Continue watching".
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private val handler = Handler(Looper.getMainLooper())
    private var currentKey: String? = null
    private val library get() = (application as YtdApp).library

    private val ticker = object : Runnable {
        override fun run() {
            record()
            handler.postDelayed(this, 5_000)
        }
    }

    override fun onCreate() {
        super.onCreate()
        val player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(StreamSourceFactory(this))
            .setAudioAttributes(
                AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                // The previous item played to its end on its own: it counts as watched.
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) currentKey?.let { library.setWatched(it, true) }
                currentKey = mediaItem?.mediaId?.takeIf { isLibraryKey(it) }
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                handler.removeCallbacks(ticker)
                if (isPlaying) handler.postDelayed(ticker, 5_000) else record()
            }

            override fun onPlaybackStateChanged(playbackState: Int) {
                if (playbackState == Player.STATE_ENDED) currentKey?.let { library.setWatched(it, true) }
            }
        })
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, PlayerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        session = MediaSession.Builder(this, player)
            .setSessionActivity(open)
            .setCallback(object : MediaSession.Callback {
                // Items sent by a controller arrive without their URI (only the request metadata
                // survives the trip), so rebuild them here.
                override fun onAddMediaItems(
                    mediaSession: MediaSession,
                    controller: MediaSession.ControllerInfo,
                    mediaItems: MutableList<MediaItem>,
                ): ListenableFuture<MutableList<MediaItem>> = Futures.immediateFuture(
                    mediaItems.map { item ->
                        if (item.localConfiguration != null) item
                        else item.buildUpon().setUri(item.requestMetadata.mediaUri).build()
                    }.toMutableList(),
                )
            })
            .build()
    }

    private fun isLibraryKey(id: String) = id.startsWith("content://")

    /** Save the position of the item that is playing (library files only, not streams). */
    private fun record() {
        val player = session?.player ?: return
        val key = player.currentMediaItem?.mediaId?.takeIf { isLibraryKey(it) } ?: return
        val duration = player.duration
        if (duration == C.TIME_UNSET || duration <= 0) return
        library.saveProgress(key, player.currentPosition, duration)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val player = session?.player
        if (player == null || !player.playWhenReady || player.mediaItemCount == 0) {
            record()
            stopSelf()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacks(ticker)
        record()
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }
}
