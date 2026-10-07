package com.ytdstudio.android.ui

import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Bedtime
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.RepeatModeUtil
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.ui.PlayerView
import com.google.common.util.concurrent.ListenableFuture
import com.ytdstudio.android.YtdApp
import com.ytdstudio.android.engine.Engine
import com.ytdstudio.android.service.PlaybackService
import java.lang.ref.WeakReference

/**
 * Full-screen player for downloaded files (offline, one or a whole queue) and for streams resolved
 * by yt-dlp. Playback itself runs in [PlaybackService], so audio carries on in the background and
 * videos can continue in a picture-in-picture window.
 */
@OptIn(UnstableApi::class)
class PlayerActivity : ComponentActivity() {
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var playerView: PlayerView? = null
    private var nowPlaying by mutableStateOf("")
    private var chromeVisible by mutableStateOf(true)
    private var inPip by mutableStateOf(false)
    /** YouTube page of each queued item (media id -> URL), for AI insights. */
    private var pageUrls: Map<String, String> = emptyMap()
    private var currentMediaId by mutableStateOf<String?>(null)
    private var insightsOpen by mutableStateOf(false)
    /** Sleep timer: pause at this time, or (sleepAtEnd) when the current item finishes. */
    private var sleepEndsAt by mutableStateOf<Long?>(null)
    private var sleepAtEnd by mutableStateOf(false)
    private var sleepLeft by mutableStateOf("")
    private var sleepDialog by mutableStateOf(false)
    private val sleepHandler = Handler(Looper.getMainLooper())
    private val sleepTick = object : Runnable {
        override fun run() {
            val end = sleepEndsAt ?: return
            val left = end - System.currentTimeMillis()
            if (left <= 0) {
                controller?.pause()
                sleepEndsAt = null
                sleepLeft = ""
                Toast.makeText(this@PlayerActivity, "Sleep timer: paused", Toast.LENGTH_SHORT).show()
                return
            }
            sleepLeft = formatDuration(left / 1000.0)
            sleepHandler.postDelayed(this, 1000)
        }
    }
    /** Another player screen took over the session: leaving this one must not touch playback. */
    private var replaced = false
    private val app get() = application as YtdApp

    private val listener = object : Player.Listener {
        override fun onMediaMetadataChanged(mediaMetadata: MediaMetadata) {
            nowPlaying = mediaMetadata.title?.toString() ?: nowPlaying
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            currentMediaId = mediaItem?.mediaId
            // "End of this item": the previous one finished on its own, so stop here.
            if (sleepAtEnd && reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                controller?.pause()
                sleepAtEnd = false
                Toast.makeText(this@PlayerActivity, "Sleep timer: stopped after that one", Toast.LENGTH_SHORT).show()
            }
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) sleepAtEnd = false
        }

        override fun onPlayerError(error: PlaybackException) {
            Toast.makeText(this@PlayerActivity, "Playback failed: " + (error.message ?: error.errorCodeName), Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Only one player screen at a time; a new one takes over the session.
        active?.get()?.takeIf { it !== this }?.let {
            it.replaced = true
            it.finish()
        }
        active = WeakReference(this)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        nowPlaying = intent.getStringExtra(EXTRA_TITLE) ?: intent.getStringArrayListExtra(EXTRA_TITLES)?.firstOrNull() ?: ""
        pageUrls = pageUrlsOf(intent)
        val loadPayload = savedInstanceState == null
        setContent {
            YtdTheme(app.prefs.settings.value) {
                Box(Modifier.fillMaxSize().background(Color.Black)) {
                    AndroidView(
                        modifier = Modifier.fillMaxSize(),
                        factory = { ctx ->
                            PlayerView(ctx).apply {
                                setShowNextButton(true)
                                setShowPreviousButton(true)
                                setShowShuffleButton(true)
                                setShowSubtitleButton(true)
                                setRepeatToggleModes(RepeatModeUtil.REPEAT_TOGGLE_MODE_ONE or RepeatModeUtil.REPEAT_TOGGLE_MODE_ALL)
                                keepScreenOn = true
                                setControllerVisibilityListener(PlayerView.ControllerVisibilityListener { visibility ->
                                    chromeVisible = visibility == android.view.View.VISIBLE
                                })
                                setFullscreenButtonClickListener { fullscreen ->
                                    requestedOrientation = if (fullscreen) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                                    else ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                                }
                                player = controller
                                playerView = this
                            }
                        },
                    )
                    AnimatedVisibility(visible = chromeVisible && !inPip, enter = fadeIn(), exit = fadeOut()) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(Brush.verticalGradient(listOf(Color(0xCC000000), Color.Transparent)))
                                .statusBarsPadding()
                                .padding(horizontal = 4.dp, vertical = 4.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconButton(onClick = { finish() }) {
                                Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back", tint = Color.White)
                            }
                            Column(Modifier.weight(1f).padding(end = 12.dp)) {
                                Text(nowPlaying, color = Color.White, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            if (sleepLeft.isNotEmpty() || sleepAtEnd) {
                                Text(if (sleepAtEnd) "after this" else sleepLeft, color = Color.White, style = MaterialTheme.typography.labelMedium)
                            }
                            IconButton(onClick = { sleepDialog = true }) {
                                Icon(Icons.Rounded.Bedtime, "Sleep timer", tint = if (sleepEndsAt != null || sleepAtEnd) MaterialTheme.colorScheme.primary else Color.White)
                            }
                            if (currentPageUrl() != null) {
                                IconButton(onClick = { insightsOpen = true }) {
                                    Icon(Icons.Rounded.AutoAwesome, "AI insights", tint = Color.White)
                                }
                            }
                        }
                    }
                    InsightsSheet()
                    if (sleepDialog) SleepDialog()
                }
            }
        }
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        controllerFuture = future
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            if (isDestroyed) {
                c.release()
                return@addListener
            }
            controller = c
            c.addListener(listener)
            playerView?.player = c
            if (loadPayload) load(c, intent)
            c.currentMediaItem?.mediaMetadata?.title?.let { nowPlaying = it.toString() }
            currentMediaId = c.currentMediaItem?.mediaId
        }, ContextCompat.getMainExecutor(this))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pageUrls = pageUrlsOf(intent)
        controller?.let { load(it, intent) }
    }

    private fun load(c: MediaController, intent: Intent) {
        val settings = app.prefs.settings.value
        val uris = intent.getStringArrayListExtra(EXTRA_URIS)
        val streamExtras = intent.getBundleExtra(EXTRA_STREAM)
        when {
            !uris.isNullOrEmpty() -> {
                val titles = intent.getStringArrayListExtra(EXTRA_TITLES).orEmpty()
                val videos = intent.getBooleanArrayExtra(EXTRA_VIDEOS)
                val items = uris.mapIndexed { i, uri ->
                    val isVideo = videos?.getOrNull(i) ?: true
                    MediaItem.Builder()
                        .setMediaId(uri)
                        .setUri(uri)
                        .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(Uri.parse(uri)).build())
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle(titles.getOrNull(i) ?: "")
                                .setMediaType(if (isVideo) MediaMetadata.MEDIA_TYPE_VIDEO else MediaMetadata.MEDIA_TYPE_MUSIC)
                                .build(),
                        )
                        .build()
                }
                val start = intent.getIntExtra(EXTRA_START, 0).coerceIn(0, items.lastIndex)
                val resumeAt = if (settings.resumePlayback) app.library.progressOf(uris[start])?.takeIf { it.inProgress }?.positionMs ?: 0L else 0L
                c.shuffleModeEnabled = intent.getBooleanExtra(EXTRA_SHUFFLE, false)
                c.setMediaItems(items, start, resumeAt)
                if (resumeAt > 0) Toast.makeText(this, "Resuming at " + formatDuration(resumeAt / 1000.0), Toast.LENGTH_SHORT).show()
            }
            streamExtras != null -> {
                val primary = intent.getStringExtra(EXTRA_PRIMARY_URL) ?: return
                val isVideo = streamExtras.containsKey(StreamSourceFactory.EXTRA_VIDEO)
                val meta = MediaMetadata.Builder()
                    .setTitle(intent.getStringExtra(EXTRA_TITLE) ?: "")
                    .setArtist(intent.getStringExtra(EXTRA_ARTIST))
                    .setArtworkUri(intent.getStringExtra(EXTRA_ARTWORK)?.let { Uri.parse(it) })
                    .setMediaType(if (isVideo) MediaMetadata.MEDIA_TYPE_VIDEO else MediaMetadata.MEDIA_TYPE_MUSIC)
                    .build()
                val item = MediaItem.Builder()
                    .setMediaId(streamMediaId(primary))
                    .setUri(primary)
                    .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(Uri.parse(primary)).setExtras(streamExtras).build())
                    .setMediaMetadata(meta)
                    .build()
                c.shuffleModeEnabled = false
                c.setMediaItem(item, intent.getLongExtra(EXTRA_START_MS, 0L).coerceAtLeast(0L))
            }
            else -> return // Opened from the media notification: just show what is playing.
        }
        c.prepare()
        c.play()
    }

    private fun currentPageUrl(): String? = currentMediaId?.let { pageUrls[it] }

    @androidx.compose.runtime.Composable
    private fun SleepDialog() {
        val options = listOf(15, 30, 45, 60, 90)
        AlertDialog(
            onDismissRequest = { sleepDialog = false },
            title = { Text("Sleep timer") },
            text = {
                Column {
                    options.forEach { minutes ->
                        TextButton(onClick = { startSleep(minutes) }, modifier = Modifier.fillMaxWidth()) { Text("$minutes minutes") }
                    }
                    TextButton(onClick = {
                        stopSleep()
                        sleepAtEnd = true
                        sleepDialog = false
                    }, modifier = Modifier.fillMaxWidth()) { Text("End of this item") }
                }
            },
            confirmButton = {
                if (sleepEndsAt != null || sleepAtEnd) TextButton(onClick = { stopSleep(); sleepDialog = false }) { Text("Turn off") }
            },
            dismissButton = { TextButton(onClick = { sleepDialog = false }) { Text("Close") } },
        )
    }

    private fun startSleep(minutes: Int) {
        stopSleep()
        sleepEndsAt = System.currentTimeMillis() + minutes * 60_000L
        sleepDialog = false
        sleepHandler.post(sleepTick)
    }

    private fun stopSleep() {
        sleepHandler.removeCallbacks(sleepTick)
        sleepEndsAt = null
        sleepAtEnd = false
        sleepLeft = ""
    }

    /** Summary and questions about the playing video; key moments seek the player. */
    @kotlin.OptIn(ExperimentalMaterial3Api::class)
    @androidx.compose.runtime.Composable
    private fun InsightsSheet() {
        val url = currentPageUrl() ?: return
        val scope = rememberCoroutineScope()
        val ctl = remember(url) { InsightController(url, scope) }
        DisposableEffect(ctl) { onDispose { ctl.stop() } }
        if (!insightsOpen || inPip) return
        ModalBottomSheet(onDismissRequest = { insightsOpen = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
            LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp)) {
                item {
                    InsightPanel(ctl, onSeek = { seconds ->
                        controller?.let {
                            it.seekTo((seconds * 1000).toLong())
                            it.play()
                        }
                        insightsOpen = false
                    }, autoSummarize = ctl.summary == null)
                }
            }
        }
    }

    private fun pageUrlsOf(intent: Intent): Map<String, String> {
        intent.getStringExtra(EXTRA_PAGE_URL)?.let { page ->
            val primary = intent.getStringExtra(EXTRA_PRIMARY_URL) ?: return emptyMap()
            return mapOf(streamMediaId(primary) to page)
        }
        val uris = intent.getStringArrayListExtra(EXTRA_URIS) ?: return emptyMap()
        val ids = intent.getStringArrayListExtra(EXTRA_VIDEO_IDS).orEmpty()
        return uris.indices.mapNotNull { i -> ids.getOrNull(i)?.takeIf { it.isNotBlank() }?.let { uris[i] to "https://www.youtube.com/watch?v=$it" } }.toMap()
    }

    private fun showsVideo(): Boolean {
        val c = controller ?: return false
        if (c.currentTracks.isTypeSupported(C.TRACK_TYPE_VIDEO)) return true
        return c.currentMediaItem?.mediaMetadata?.mediaType == MediaMetadata.MEDIA_TYPE_VIDEO
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val c = controller ?: return
        if (app.prefs.settings.value.pictureInPicture && c.isPlaying && showsVideo()) enterPip()
    }

    private fun enterPip() {
        val size = controller?.videoSize
        val ratio = if (size != null && size.width > 0 && size.height > 0) {
            Rational(size.width, size.height).coerceRatio()
        } else Rational(16, 9)
        runCatching { enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(ratio).build()) }
    }

    /** Android only accepts aspect ratios between 1:2.39 and 2.39:1. */
    private fun Rational.coerceRatio(): Rational = when {
        toFloat() > 2.39f -> Rational(239, 100)
        toFloat() < 1 / 2.39f -> Rational(100, 239)
        else -> this
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        playerView?.useController = !isInPictureInPictureMode
        // Closing the floating window leaves the activity stopped: treat it like leaving the player.
        if (!isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED) pauseVideoIfForeground()
    }

    override fun onStop() {
        super.onStop()
        if (!isInPictureInPictureMode) pauseVideoIfForeground()
    }

    /** Videos stop when you leave them, unless background play is on. Audio keeps going. */
    private fun pauseVideoIfForeground() {
        if (!replaced && !app.prefs.settings.value.backgroundVideo && showsVideo()) controller?.pause()
    }

    override fun onDestroy() {
        sleepHandler.removeCallbacks(sleepTick)
        val c = controller
        if (isFinishing && !replaced && c != null && showsVideo() && !app.prefs.settings.value.backgroundVideo) {
            c.stop()
            c.clearMediaItems()
        }
        c?.removeListener(listener)
        playerView?.player = null
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        if (active?.get() === this) active = null
        super.onDestroy()
    }

    companion object {
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_ARTIST = "artist"
        private const val EXTRA_ARTWORK = "artwork"
        private const val EXTRA_URIS = "uris"
        private const val EXTRA_TITLES = "titles"
        private const val EXTRA_VIDEOS = "videos"
        private const val EXTRA_START = "start"
        private const val EXTRA_SHUFFLE = "shuffle"
        private const val EXTRA_STREAM = "stream"
        private const val EXTRA_PRIMARY_URL = "primaryUrl"
        private const val EXTRA_PAGE_URL = "pageUrl"
        private const val EXTRA_VIDEO_IDS = "videoIds"
        private const val EXTRA_START_MS = "startMs"

        private fun streamMediaId(primary: String) = "stream:" + primary.hashCode()

        private var active: WeakReference<PlayerActivity>? = null

        data class Entry(val uri: String, val title: String, val isVideo: Boolean, val videoId: String? = null)

        /** Play [entries] in order starting at [start] (or shuffled). */
        fun queue(context: Context, entries: List<Entry>, start: Int = 0, shuffle: Boolean = false): Intent =
            Intent(context, PlayerActivity::class.java)
                .putStringArrayListExtra(EXTRA_URIS, ArrayList(entries.map { it.uri }))
                .putStringArrayListExtra(EXTRA_TITLES, ArrayList(entries.map { it.title }))
                .putExtra(EXTRA_VIDEOS, entries.map { it.isVideo }.toBooleanArray())
                .putStringArrayListExtra(EXTRA_VIDEO_IDS, ArrayList(entries.map { it.videoId ?: "" }))
                .putExtra(EXTRA_START, start)
                .putExtra(EXTRA_SHUFFLE, shuffle)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)

        fun local(context: Context, uri: Uri, title: String, isVideo: Boolean = true): Intent =
            queue(context, listOf(Entry(uri.toString(), title, isVideo)))

        fun stream(context: Context, source: Engine.StreamSource, thumbnail: String?, startMs: Long = 0L): Intent {
            val primary = (source.video ?: source.audio)?.url
            return Intent(context, PlayerActivity::class.java)
                .putExtra(EXTRA_TITLE, source.title)
                .putExtra(EXTRA_ARTIST, source.uploader)
                .putExtra(EXTRA_ARTWORK, thumbnail)
                .putExtra(EXTRA_PRIMARY_URL, primary)
                .putExtra(EXTRA_STREAM, StreamSourceFactory.extras(source))
                .putExtra(EXTRA_PAGE_URL, source.pageUrl)
                .putExtra(EXTRA_START_MS, startMs)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
    }
}
