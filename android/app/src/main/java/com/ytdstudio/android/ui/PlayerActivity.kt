package com.ytdstudio.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.PlayerView
import com.ytdstudio.android.engine.Engine
import org.json.JSONObject

/** Full-screen player for downloaded files (offline) and for streams resolved by yt-dlp. */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private var player: ExoPlayer? = null
    private var resumeAt = 0L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        resumeAt = savedInstanceState?.getLong("position") ?: 0L
        val view = PlayerView(this).apply {
            setShowNextButton(false)
            setShowPreviousButton(false)
            keepScreenOn = true
        }
        setContentView(view)
        val exo = ExoPlayer.Builder(this).build()
        player = exo
        view.player = exo
        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(this@PlayerActivity, "Playback failed: " + (error.message ?: error.errorCodeName), Toast.LENGTH_LONG).show()
            }
        })
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        setTitle(title)
        val meta = MediaMetadata.Builder().setTitle(title).build()
        val local = intent.getStringExtra(EXTRA_URI)
        if (local != null) {
            exo.setMediaItem(MediaItem.Builder().setUri(Uri.parse(local)).setMediaMetadata(meta).build())
        } else {
            val sources = listOfNotNull(trackSource(EXTRA_VIDEO, meta), trackSource(EXTRA_AUDIO, meta))
            if (sources.isEmpty()) {
                finish()
                return
            }
            exo.setMediaSource(if (sources.size == 1) sources[0] else MergingMediaSource(*sources.toTypedArray()))
        }
        exo.prepare()
        if (resumeAt > 0) exo.seekTo(resumeAt)
        exo.playWhenReady = true
    }

    private fun trackSource(key: String, meta: MediaMetadata): MediaSource? {
        val raw = intent.getStringExtra(key) ?: return null
        val o = JSONObject(raw)
        val headers = mutableMapOf<String, String>()
        o.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.getString(k) } }
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(headers.remove("User-Agent") ?: DEFAULT_UA)
            .setDefaultRequestProperties(headers)
        val item = MediaItem.Builder().setUri(o.getString("url")).setMediaMetadata(meta).build()
        return if (o.optBoolean("hls")) HlsMediaSource.Factory(http).createMediaSource(item)
        else ProgressiveMediaSource.Factory(ChunkedDataSource.Factory(http)).createMediaSource(item)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        player?.let { outState.putLong("position", it.currentPosition) }
    }

    override fun onStop() {
        super.onStop()
        player?.pause()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_URI = "uri"
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_VIDEO = "video"
        private const val EXTRA_AUDIO = "audio"
        private const val DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"

        fun local(context: Context, uri: Uri, title: String): Intent =
            Intent(context, PlayerActivity::class.java).putExtra(EXTRA_URI, uri.toString()).putExtra(EXTRA_TITLE, title)

        fun stream(context: Context, source: Engine.StreamSource): Intent {
            fun encode(t: Engine.Track) = JSONObject().apply {
                put("url", t.url)
                put("hls", t.isHls)
                put("headers", JSONObject(t.headers as Map<*, *>))
            }.toString()
            return Intent(context, PlayerActivity::class.java)
                .putExtra(EXTRA_TITLE, source.title)
                .apply {
                    source.video?.let { putExtra(EXTRA_VIDEO, encode(it)) }
                    source.audio?.let { putExtra(EXTRA_AUDIO, encode(it)) }
                }
        }
    }
}
