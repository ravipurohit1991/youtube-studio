package com.ytdstudio.android.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.util.LruCache
import android.util.Size
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

private val cache = LruCache<String, ImageBitmap>(80)

/** Thumbnail from the web (YouTube's i.ytimg.com) or from MediaStore (content://). */
@Composable
fun Thumb(source: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val image by produceState<ImageBitmap?>(source?.let { cache.get(it) }, source) {
        if (source == null || value != null) return@produceState
        value = withContext(Dispatchers.IO) {
            try {
                val bitmap = if (source.startsWith("content://")) {
                    context.contentResolver.loadThumbnail(Uri.parse(source), Size(480, 270), null)
                } else {
                    val conn = URL(source).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10000
                    conn.readTimeout = 15000
                    conn.inputStream.use { BitmapFactory.decodeStream(it) }
                }
                bitmap?.asImageBitmap()?.also { cache.put(source, it) }
            } catch (e: Exception) {
                null
            }
        }
    }
    Box(modifier.background(MaterialTheme.colorScheme.surfaceVariant)) {
        image?.let { Image(it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize()) }
    }
}
