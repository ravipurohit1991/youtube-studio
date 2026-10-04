package com.ytdstudio.android.data

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import java.io.File

data class LibraryItem(
    val uri: Uri,
    val name: String,
    val title: String,
    val isVideo: Boolean,
    val size: Long,
    val durationMs: Long,
    val dateAdded: Long,
    val mime: String?,
)

/**
 * Finished downloads go into the phone's shared Movies/YTD Studio and Music/YTD Studio folders
 * through MediaStore. No storage permission is needed for that (Android 10+), the files show up
 * in the Gallery and any music/video player, and they survive uninstalling the app.
 */
object MediaLibrary {
    const val FOLDER = "YTD Studio"
    private val VIDEO_EXT = setOf("mp4", "mkv", "webm", "mov", "m4v", "3gp")

    fun isVideoFile(name: String) = name.substringAfterLast('.', "").lowercase() in VIDEO_EXT

    fun mimeFor(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "mp4", "m4v" -> "video/mp4"
        "mkv" -> "video/x-matroska"
        "webm" -> "video/webm"
        "mov" -> "video/quicktime"
        "3gp" -> "video/3gpp"
        "m4a" -> "audio/mp4"
        "mp3" -> "audio/mpeg"
        "opus", "ogg", "oga" -> "audio/ogg"
        "flac" -> "audio/flac"
        "wav" -> "audio/wav"
        "aac" -> "audio/aac"
        else -> "application/octet-stream"
    }

    private fun collection(video: Boolean): Uri =
        if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)

    fun folderLabel(video: Boolean) = (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_MUSIC) + "/" + FOLDER

    /** Copy a finished file into the shared collection and return its content URI. */
    fun save(context: Context, file: File, onProgress: (Float) -> Unit = {}): Uri {
        val video = isVideoFile(file.name)
        val resolver = context.contentResolver
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
            put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(file.name))
            put(MediaStore.MediaColumns.RELATIVE_PATH, folderLabel(video))
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val uri = resolver.insert(collection(video), values) ?: throw IllegalStateException("Android refused to create the file in ${folderLabel(video)}")
        try {
            val total = file.length().coerceAtLeast(1)
            resolver.openOutputStream(uri)!!.use { out ->
                file.inputStream().use { input ->
                    val buffer = ByteArray(1 shl 16)
                    var copied = 0L
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        copied += n
                        onProgress(copied.toFloat() / total)
                    }
                }
            }
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            return uri
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    /** Our downloads, newest first. Without read permission Android only returns files this install created. */
    fun query(context: Context): List<LibraryItem> {
        val out = mutableListOf<LibraryItem>()
        for (video in listOf(true, false)) {
            val projection = arrayOf(
                MediaStore.MediaColumns._ID,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.TITLE,
                MediaStore.MediaColumns.SIZE,
                MediaStore.MediaColumns.DURATION,
                MediaStore.MediaColumns.DATE_ADDED,
                MediaStore.MediaColumns.MIME_TYPE,
            )
            val selection = "${MediaStore.MediaColumns.RELATIVE_PATH} LIKE ? AND ${MediaStore.MediaColumns.IS_PENDING} = 0"
            val args = arrayOf(folderLabel(video) + "%")
            try {
                context.contentResolver.query(collection(video), projection, selection, args, "${MediaStore.MediaColumns.DATE_ADDED} DESC")?.use { c ->
                    while (c.moveToNext()) {
                        val id = c.getLong(0)
                        val name = c.getString(1) ?: continue
                        out += LibraryItem(
                            uri = ContentUris.withAppendedId(collection(video), id),
                            name = name,
                            title = cleanTitle(name, c.getString(2)),
                            isVideo = video,
                            size = c.getLong(3),
                            durationMs = c.getLong(4),
                            dateAdded = c.getLong(5),
                            mime = c.getString(6),
                        )
                    }
                }
            } catch (e: Exception) {
                android.util.Log.w("MediaLibrary", "query failed", e)
            }
        }
        return out.sortedByDescending { it.dateAdded }
    }

    /** "Title [videoId].mp4" -> "Title". Prefers the embedded title tag when Android read one. */
    fun cleanTitle(name: String, tagTitle: String? = null): String {
        val base = name.substringBeforeLast('.')
        val stripped = base.replace(Regex("\\s*\\[[A-Za-z0-9_-]{6,}]\\s*$"), "").trim()
        val tag = tagTitle?.trim()
        return if (!tag.isNullOrEmpty() && tag != base) tag else stripped.ifEmpty { base }
    }
}
