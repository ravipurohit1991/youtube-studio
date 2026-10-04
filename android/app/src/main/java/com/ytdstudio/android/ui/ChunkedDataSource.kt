package com.ytdstudio.android.ui

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import kotlin.math.min

/**
 * googlevideo throttles or rejects big open-ended reads of adaptive formats (yt-dlp downloads them
 * in 10 MB pieces for that reason). This wrapper turns one logical read into consecutive bounded
 * Range requests, invisibly to the player.
 */
@UnstableApi
class ChunkedDataSource(private val upstream: DataSource, private val chunkSize: Long = 10L * 1024 * 1024) : DataSource {
    private var spec: DataSpec? = null
    private var position = 0L
    private var end = -1L
    private var chunkRemaining = 0L

    override fun addTransferListener(transferListener: TransferListener) = upstream.addTransferListener(transferListener)

    override fun open(dataSpec: DataSpec): Long {
        spec = dataSpec
        position = dataSpec.position
        end = if (dataSpec.length == C.LENGTH_UNSET.toLong()) -1L else dataSpec.position + dataSpec.length
        openChunk()
        return if (end >= 0) end - position else C.LENGTH_UNSET.toLong()
    }

    private fun openChunk() {
        val base = spec!!
        val want = if (end >= 0) min(chunkSize, end - position) else chunkSize
        val opened = upstream.open(base.subrange(position - base.position, want))
        chunkRemaining = if (opened == C.LENGTH_UNSET.toLong()) want else min(opened, want)
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        if (end in 0..position) return C.RESULT_END_OF_INPUT
        if (chunkRemaining <= 0L) {
            upstream.close()
            try {
                openChunk()
            } catch (e: HttpDataSource.InvalidResponseCodeException) {
                if (e.responseCode == 416) return C.RESULT_END_OF_INPUT
                throw e
            }
            if (chunkRemaining <= 0L) return C.RESULT_END_OF_INPUT
        }
        val n = upstream.read(buffer, offset, min(length.toLong(), chunkRemaining).toInt())
        if (n == C.RESULT_END_OF_INPUT) return C.RESULT_END_OF_INPUT // the file ended inside this chunk
        position += n
        chunkRemaining -= n
        return n
    }

    override fun getUri(): Uri? = upstream.uri

    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun close() {
        upstream.close()
    }

    class Factory(private val upstream: DataSource.Factory) : DataSource.Factory {
        override fun createDataSource(): DataSource = ChunkedDataSource(upstream.createDataSource())
    }
}
