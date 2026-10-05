package com.ytdstudio.android.ui

import android.content.Context
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.drm.DrmSessionManagerProvider
import androidx.media3.exoplayer.hls.HlsMediaSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.MergingMediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import com.ytdstudio.android.engine.Engine
import org.json.JSONObject

/**
 * Local files play through the default factory. Streams resolved by yt-dlp carry their tracks in
 * the item's extras: a video-only and an audio-only URL (high resolutions come as two streams),
 * each with the headers googlevideo expects. Those become one merged source, read in bounded
 * chunks the way yt-dlp reads them.
 */
@UnstableApi
class StreamSourceFactory(context: Context) : MediaSource.Factory {
    private val default = DefaultMediaSourceFactory(context)

    override fun setDrmSessionManagerProvider(drmSessionManagerProvider: DrmSessionManagerProvider): MediaSource.Factory {
        default.setDrmSessionManagerProvider(drmSessionManagerProvider)
        return this
    }

    override fun setLoadErrorHandlingPolicy(loadErrorHandlingPolicy: LoadErrorHandlingPolicy): MediaSource.Factory {
        default.setLoadErrorHandlingPolicy(loadErrorHandlingPolicy)
        return this
    }

    override fun getSupportedTypes(): IntArray = default.supportedTypes

    override fun createMediaSource(mediaItem: MediaItem): MediaSource {
        val extras = mediaItem.requestMetadata.extras
        val tracks = listOfNotNull(extras?.getString(EXTRA_VIDEO), extras?.getString(EXTRA_AUDIO))
        if (tracks.isEmpty()) return default.createMediaSource(mediaItem)
        val sources = tracks.map { trackSource(JSONObject(it), mediaItem) }
        return if (sources.size == 1) sources[0] else MergingMediaSource(*sources.toTypedArray())
    }

    private fun trackSource(o: JSONObject, parent: MediaItem): MediaSource {
        val headers = mutableMapOf<String, String>()
        o.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> headers[k] = h.getString(k) } }
        val http = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(headers.remove("User-Agent") ?: DEFAULT_UA)
            .setDefaultRequestProperties(headers)
        val item = MediaItem.Builder()
            .setUri(o.getString("url"))
            .setMediaId(parent.mediaId)
            .setMediaMetadata(parent.mediaMetadata)
            .build()
        return if (o.optBoolean("hls")) HlsMediaSource.Factory(http).createMediaSource(item)
        else ProgressiveMediaSource.Factory(ChunkedDataSource.Factory(http)).createMediaSource(item)
    }

    companion object {
        const val EXTRA_VIDEO = "ytd.video"
        const val EXTRA_AUDIO = "ytd.audio"
        private const val DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36"

        fun encode(track: Engine.Track): String = JSONObject().apply {
            put("url", track.url)
            put("hls", track.isHls)
            put("headers", JSONObject(track.headers as Map<*, *>))
        }.toString()

        /** Extras that turn a MediaItem into a stream of [source]'s tracks. */
        fun extras(source: Engine.StreamSource): Bundle = Bundle().apply {
            source.video?.let { putString(EXTRA_VIDEO, encode(it)) }
            source.audio?.let { putString(EXTRA_AUDIO, encode(it)) }
        }
    }
}
