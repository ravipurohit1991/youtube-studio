@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.data.VideoMeta

/**
 * What happens after a link is pasted or shared: one sheet that shows what it is and offers to
 * watch it right away, listen to it, or download it (a whole playlist in one tap).
 */
@Composable
fun LinkSheet(vm: MainViewModel) {
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val startStream = { link: String, title: String?, thumb: String?, audioOnly: Boolean ->
        vm.watch(link, title, thumb, audioOnly) { source, thumbnail ->
            context.startActivity(PlayerActivity.stream(context, source, thumbnail))
        }
    }
    ModalBottomSheet(onDismissRequest = { vm.closeSheet() }, sheetState = sheetState) {
        val meta = vm.meta
        LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            when {
                vm.analyzing -> item {
                    Row(Modifier.fillMaxWidth().padding(vertical = 28.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                        CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp)
                        Spacer(Modifier.width(12.dp))
                        Text("Reading the link...", style = MaterialTheme.typography.bodyLarge)
                    }
                }
                vm.analyzeError != null -> item {
                    EmptyState(Icons.Rounded.ErrorOutline, "Couldn't read that link", vm.analyzeError ?: "") {
                        TextButton(onClick = { vm.analyze() }) { Text("Try again") }
                    }
                }
                meta != null -> {
                    item { Header(meta) }
                    if (!meta.isPlaylist) {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                val busy = vm.resolvingStream == meta.url
                                Button(onClick = { startStream(meta.url, meta.title, meta.thumbnail, false) }, enabled = !busy, modifier = Modifier.weight(1f)) {
                                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
                                    else Icon(Icons.Rounded.PlayArrow, null)
                                    Spacer(Modifier.width(6.dp))
                                    Text("Watch now")
                                }
                                FilledTonalButton(onClick = { startStream(meta.url, meta.title, meta.thumbnail, true) }, enabled = !busy, modifier = Modifier.weight(1f)) {
                                    Icon(Icons.Rounded.Headphones, null)
                                    Spacer(Modifier.width(6.dp))
                                    Text("Listen")
                                }
                            }
                        }
                        item {
                            Text(
                                "Streams play without ads and without saving anything. Download to watch offline.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        item { HorizontalDivider() }
                    }
                    item { DownloadOptions(vm, meta) }
                    if (meta.isPlaylist) {
                        item {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("${vm.selected.size} of ${meta.entries.size} selected", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
                                TextButton(onClick = { vm.selected = meta.entries.map { it.id }.toSet() }) { Text("All") }
                                TextButton(onClick = { vm.selected = emptySet() }) { Text("None") }
                            }
                        }
                        itemsIndexed(meta.entries, key = { i, e -> "$i:${e.id}" }) { index, entry ->
                            Row(
                                Modifier.fillMaxWidth().clip(MaterialTheme.shapes.small).clickable {
                                    vm.selected = if (entry.id in vm.selected) vm.selected - entry.id else vm.selected + entry.id
                                }.padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Checkbox(checked = entry.id in vm.selected, onCheckedChange = null, modifier = Modifier.padding(horizontal = 6.dp))
                                Box(Modifier.width(88.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp))) {
                                    Thumb(entry.thumbnail, Modifier.matchParentSize())
                                }
                                Spacer(Modifier.width(10.dp))
                                Column(Modifier.weight(1f)) {
                                    Text("${index + 1}. ${entry.title}", maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                    if (entry.duration != null) Text(formatDuration(entry.duration), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                val busy = vm.resolvingStream == entry.url
                                IconButton(onClick = { startStream(entry.url, entry.title, entry.thumbnail, false) }, enabled = !busy) {
                                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.PlayArrow, "Watch")
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(meta: VideoMeta) {
    Column {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(MaterialTheme.shapes.large)) {
            Thumb(meta.thumbnail, Modifier.matchParentSize())
            val badge = when {
                meta.isPlaylist -> "Playlist · ${meta.entries.size} videos"
                meta.duration != null -> formatDuration(meta.duration)
                else -> null
            }
            if (badge != null) {
                Text(
                    badge,
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp)
                        .background(Color(0xC0000000), RoundedCornerShape(6.dp))
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        Text(meta.title, style = MaterialTheme.typography.titleLarge, maxLines = 3, overflow = TextOverflow.Ellipsis)
        val sub = listOfNotNull(
            meta.uploader,
            meta.viewCount?.let { formatCount(it) + " views" },
            if (meta.isPlaylist) totalDuration(meta)?.let { "$it in total" } else null,
        ).joinToString(" · ")
        if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

private fun totalDuration(meta: VideoMeta): String? {
    val seconds = meta.entries.sumOf { it.duration ?: 0.0 }
    return if (seconds > 0) formatDuration(seconds) else null
}

@Composable
private fun DownloadOptions(vm: MainViewModel, meta: VideoMeta) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(if (meta.isPlaylist) "Download the playlist" else "Download", style = MaterialTheme.typography.titleMedium)
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(selected = vm.mode == DownloadMode.VIDEO, onClick = { vm.mode = DownloadMode.VIDEO }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Video") }
            SegmentedButton(selected = vm.mode == DownloadMode.AUDIO, onClick = { vm.mode = DownloadMode.AUDIO }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Audio only") }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (vm.mode == DownloadMode.VIDEO) {
                val offered = meta.heights.ifEmpty { listOf(1080, 720, 480, 360) }
                val options = listOf(0) + Prefs.HEIGHTS.filter { h -> h > 0 && offered.any { it >= h } }.ifEmpty { offered }
                options.distinct().forEach { h ->
                    FilterChip(selected = vm.height == h, onClick = { vm.height = h }, label = { Text(if (h == 0) "Best" else "${h}p") })
                }
            } else {
                Prefs.AUDIO_FORMATS.forEach { f ->
                    FilterChip(selected = vm.audioFormat == f, onClick = { vm.audioFormat = f }, label = { Text(f.uppercase()) })
                }
            }
        }
        if (meta.isPlaylist) {
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Rounded.Sync, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Keep in sync", style = MaterialTheme.typography.labelLarge)
                        Text(
                            "Remember this playlist. Sync later from Downloads to get only the videos added since.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(checked = vm.keepSynced, onCheckedChange = { vm.keepSynced = it })
                }
            }
        }
        Text(
            when {
                vm.mode == DownloadMode.AUDIO -> "Saved in Music/YTD Studio with cover art. M4A keeps YouTube's audio as is; MP3 re-encodes it."
                else -> "Saved as MP4 in Movies/YTD Studio. 1080p and below use H.264, which every phone plays."
            } + if (meta.isPlaylist && vm.prefs.settings.value.playlistFolders) " Playlists get their own folder." else "",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(onClick = { vm.download() }, modifier = Modifier.fillMaxWidth().height(50.dp), enabled = !meta.isPlaylist || vm.selected.isNotEmpty()) {
            Icon(Icons.Rounded.Download, null)
            Spacer(Modifier.width(8.dp))
            Text(
                when {
                    meta.isPlaylist && vm.selected.size == meta.entries.size -> "Download all ${meta.entries.size}"
                    meta.isPlaylist -> "Download ${vm.selected.size} selected"
                    vm.mode == DownloadMode.AUDIO -> "Download audio"
                    else -> "Download video"
                },
            )
        }
        if (!meta.isPlaylist) {
            OutlinedButton(onClick = { vm.closeSheet() }, modifier = Modifier.fillMaxWidth()) { Text("Close") }
        }
    }
}
