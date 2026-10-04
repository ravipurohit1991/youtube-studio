@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.DownloadJob
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.data.Prefs

@Composable
fun DownloadScreen(vm: MainViewModel) {
    val jobs by vm.store.jobs.collectAsStateWithLifecycle()
    var showHistory by rememberSaveable { mutableStateOf(false) }
    val active = jobs.filter { it.status == JobStatus.QUEUED || it.status.isActive }
    val finished = jobs.filter { it.status.isFinished }
    val visible = if (showHistory) finished else active
    val context = LocalContext.current

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { LinkInput(vm) }
        if (vm.analyzing) item { LoadingRow("Reading title and available qualities...") }
        vm.analyzeError?.let { err -> item { ErrorCard(err) { vm.analyze() } } }
        vm.meta?.let { item { PreviewCard(vm) } }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    SegmentedButton(selected = !showHistory, onClick = { showHistory = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                        Text("Queue" + if (active.isNotEmpty()) " · ${active.size}" else "")
                    }
                    SegmentedButton(selected = showHistory, onClick = { showHistory = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                        Text("History" + if (finished.isNotEmpty()) " · ${finished.size}" else "")
                    }
                }
                if (showHistory && finished.isNotEmpty()) TextButton(onClick = { vm.clearFinished() }) { Text("Clear") }
            }
        }
        if (visible.isEmpty()) {
            item {
                Text(
                    if (showHistory) "Finished downloads show up here." else "Nothing downloading. Paste a link above, or share a video from the YouTube app to YTD Studio.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 24.dp, horizontal = 8.dp),
                )
            }
        }
        items(visible, key = { it.id }) { job ->
            JobCard(
                job,
                onCancel = { vm.cancel(job.id) },
                onRetry = { vm.retry(job.id) },
                onRemove = { vm.remove(job.id) },
                onPlay = { job.outputUri?.let { context.startActivity(PlayerActivity.local(context, Uri.parse(it), job.title)) } },
            )
        }
    }
}

@Composable
private fun LinkInput(vm: MainViewModel) {
    val context = LocalContext.current
    Card {
        Column(Modifier.padding(14.dp)) {
            OutlinedTextField(
                value = vm.url,
                onValueChange = { vm.url = it },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                placeholder = { Text("https://youtu.be/... or a playlist link") },
                trailingIcon = {
                    if (vm.url.isNotEmpty()) IconButton(onClick = { vm.url = ""; vm.meta = null; vm.analyzeError = null }) { Icon(Icons.Rounded.Close, "Clear") }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { vm.analyze() }),
            )
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TextButton(onClick = {
                    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                    val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                    val link = extractUrl(text)
                    if (link == null) vm.message = "No link on the clipboard." else vm.analyze(link)
                }) {
                    Icon(Icons.Rounded.ContentPaste, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Paste")
                }
                Spacer(Modifier.weight(1f))
                Button(onClick = { vm.analyze() }, enabled = !vm.analyzing) {
                    Icon(Icons.Rounded.Search, null)
                    Spacer(Modifier.width(6.dp))
                    Text(if (vm.analyzing) "Reading..." else "Analyze")
                }
            }
        }
    }
}

@Composable
private fun PreviewCard(vm: MainViewModel) {
    val meta = vm.meta ?: return
    Card {
        Column(Modifier.padding(14.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                Thumb(meta.thumbnail, Modifier.matchParentSize())
                if (meta.duration != null) {
                    Text(
                        formatDuration(meta.duration),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp)
                            .background(Color(0xB3000000), RoundedCornerShape(4.dp))
                            .padding(horizontal = 5.dp, vertical = 1.dp),
                    )
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(meta.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            val sub = listOfNotNull(meta.uploader, if (meta.isPlaylist) "Playlist · ${meta.entries.size} videos" else null).joinToString(" · ")
            if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)

            if (meta.isPlaylist) {
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${vm.selected.size} of ${meta.entries.size} selected", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.selected = meta.entries.map { it.id }.toSet() }) { Text("All") }
                    TextButton(onClick = { vm.selected = emptySet() }) { Text("None") }
                }
                Column {
                    meta.entries.take(200).forEachIndexed { index, entry ->
                        Row(
                            Modifier.fillMaxWidth().clickable {
                                vm.selected = if (entry.id in vm.selected) vm.selected - entry.id else vm.selected + entry.id
                            },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Checkbox(checked = entry.id in vm.selected, onCheckedChange = null, modifier = Modifier.padding(8.dp))
                            Text("${index + 1}. ${entry.title}", maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                            Text(if (entry.duration != null) formatDuration(entry.duration) else "", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            Spacer(Modifier.height(12.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(selected = vm.mode == DownloadMode.VIDEO, onClick = { vm.mode = DownloadMode.VIDEO }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Video + audio") }
                SegmentedButton(selected = vm.mode == DownloadMode.AUDIO, onClick = { vm.mode = DownloadMode.AUDIO }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Audio only") }
            }
            Spacer(Modifier.height(10.dp))
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
            Text(
                if (vm.mode == DownloadMode.VIDEO) "Saved as MP4 in Movies/YTD Studio. 1080p and below use H.264, which every phone plays."
                else "Saved in Music/YTD Studio with cover art. M4A keeps YouTube's audio as is; MP3 re-encodes it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
            Spacer(Modifier.height(12.dp))
            Button(onClick = { vm.download() }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Download, null)
                Spacer(Modifier.width(6.dp))
                Text(
                    when {
                        meta.isPlaylist -> "Download ${vm.selected.size} videos"
                        vm.mode == DownloadMode.AUDIO -> "Download audio"
                        else -> "Download video"
                    },
                )
            }
        }
    }
}

@Composable
fun JobCard(job: DownloadJob, onCancel: () -> Unit, onRetry: () -> Unit, onRemove: () -> Unit, onPlay: () -> Unit) {
    Card {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Thumb(job.thumbnail, Modifier.width(96.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp)))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(job.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.height(4.dp))
                val stageColor = when (job.status) {
                    JobStatus.COMPLETED -> Ok
                    JobStatus.FAILED -> MaterialTheme.colorScheme.error
                    JobStatus.CANCELED -> Warn
                    JobStatus.PROCESSING, JobStatus.SAVING -> Accent
                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (job.status.isActive) {
                        CircularProgressIndicator(Modifier.size(11.dp), strokeWidth = 1.5.dp, color = stageColor)
                        Spacer(Modifier.width(6.dp))
                    }
                    Text(job.stage ?: job.status.name.lowercase(), style = MaterialTheme.typography.labelMedium, color = stageColor)
                }
                if (job.status == JobStatus.FAILED && job.error != null) {
                    Text(job.error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
                if (!job.status.isFinished) {
                    Spacer(Modifier.height(6.dp))
                    // Moving bar while there are no byte counts yet (starting, merging, converting).
                    if (job.status == JobStatus.DOWNLOADING && job.percent > 0f) {
                        LinearProgressIndicator(progress = { job.percent / 100f }, modifier = Modifier.fillMaxWidth())
                    } else {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                    }
                }
                Spacer(Modifier.height(4.dp))
                val bytes = when {
                    job.status == JobStatus.COMPLETED -> formatBytes(job.totalBytes)
                    job.totalBytes > 0 -> formatBytes(job.downloadedBytes) + " / " + formatBytes(job.totalBytes)
                    else -> null
                }
                val parts = listOfNotNull(
                    job.qualityLabel,
                    bytes,
                    if (job.status == JobStatus.DOWNLOADING && job.percent > 0) "${job.percent.toInt()}%" else null,
                    job.speed?.takeIf { job.status == JobStatus.DOWNLOADING },
                    job.eta?.takeIf { job.status == JobStatus.DOWNLOADING }?.let { "ETA $it" },
                )
                Text(parts.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Column(horizontalAlignment = Alignment.End) {
                when {
                    job.status == JobStatus.COMPLETED && job.outputUri != null -> IconButton(onClick = onPlay) { Icon(Icons.Rounded.PlayArrow, "Play") }
                    !job.status.isFinished -> IconButton(onClick = onCancel) { Icon(Icons.Rounded.Close, "Stop") }
                    else -> IconButton(onClick = onRetry) { Icon(Icons.Rounded.Refresh, "Retry") }
                }
                if (job.status.isFinished) IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, "Remove from list") }
            }
        }
    }
}

@Composable
fun LoadingRow(label: String) {
    Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun ErrorCard(message: String, onRetry: () -> Unit) {
    Card {
        Column(Modifier.padding(14.dp)) {
            Text("Something went wrong", color = MaterialTheme.colorScheme.error, fontWeight = FontWeight.SemiBold)
            Text(message, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = onRetry) { Text("Try again") }
        }
    }
}
