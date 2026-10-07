@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.DownloadDone
import androidx.compose.material.icons.rounded.Downloading
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material.icons.rounded.SyncDisabled
import androidx.compose.material.icons.rounded.VerticalAlignTop
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.DownloadJob
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.SavedPlaylist

private val DownloadJob.pending: Boolean get() = status == JobStatus.QUEUED || status == JobStatus.PAUSED || status.isActive

@Composable
fun DownloadsScreen(vm: MainViewModel) {
    val jobs by vm.store.jobs.collectAsStateWithLifecycle()
    val state by vm.library.state.collectAsStateWithLifecycle()
    val settings by vm.prefs.settings.collectAsStateWithLifecycle()
    var showHistory by rememberSaveable { mutableStateOf(false) }
    var search by rememberSaveable { mutableStateOf("") }
    val active = jobs.filter { it.pending }.sortedBy { it.createdAt }
    val finished = jobs.filter { it.status.isFinished }
    val shown = if (showHistory) {
        finished.filter { search.isBlank() || it.title.contains(search, ignoreCase = true) || (it.folder?.contains(search, ignoreCase = true) == true) }
    } else active
    val running = active.filter { it.status.isActive }
    val waiting = active.count { it.status == JobStatus.QUEUED }
    val paused = active.count { it.status == JobStatus.PAUSED }
    val failed = finished.count { it.status == JobStatus.FAILED }
    val context = LocalContext.current

    LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item {
            Column(Modifier.statusBarsPadding().padding(top = 12.dp)) {
                Text("Downloads", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "Saved to ${MediaLibrary.folderLabel(true)} and ${MediaLibrary.folderLabel(false)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                LinkBar(vm)
            }
        }
        if (active.isNotEmpty()) {
            item {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primaryContainer) {
                    Column(Modifier.fillMaxWidth().padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "${running.size} running · $waiting waiting" + if (paused > 0) " · $paused paused" else "",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                                val speeds = running.mapNotNull { it.speed }
                                Text(
                                    (if (speeds.isNotEmpty()) speeds.joinToString(" + ") + " · " else "") + "up to ${settings.concurrentDownloads} at once" +
                                        if (settings.rateLimit.isNotBlank()) " · capped at ${settings.rateLimit}B/s" else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                                )
                            }
                            if (running.isNotEmpty() || waiting > 0) {
                                FilledTonalButton(onClick = { vm.pauseAll() }) {
                                    Icon(Icons.Rounded.Pause, null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Pause all")
                                }
                            } else if (paused > 0) {
                                FilledTonalButton(onClick = { vm.resumeAll() }) {
                                    Icon(Icons.Rounded.PlayArrow, null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("Resume all")
                                }
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        val overall = active.sumOf { if (it.status.isActive) it.percent.toDouble() else 0.0 } / (active.size * 100.0)
                        LinearProgressIndicator(
                            progress = { overall.toFloat().coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth(),
                            trackColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.5f),
                        )
                    }
                }
            }
        }
        if (state.saved.isNotEmpty()) {
            item {
                SectionHeader(
                    "Followed playlists and channels" + if (settings.autoSyncHours > 0) " · every ${settings.autoSyncHours} h" else "",
                    action = "Sync all",
                ) { vm.syncAll() }
            }
            items(state.saved.sortedBy { it.title.lowercase() }, key = { "saved:" + it.id }) { saved -> SavedPlaylistRow(vm, saved) }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                    SegmentedButton(selected = !showHistory, onClick = { showHistory = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                        Text("Queue" + if (active.isNotEmpty()) " · ${active.size}" else "")
                    }
                    SegmentedButton(selected = showHistory, onClick = { showHistory = true }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                        Text("History" + if (finished.isNotEmpty()) " · ${finished.size}" else "")
                    }
                }
            }
        }
        if (showHistory && finished.isNotEmpty()) {
            item {
                Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
                    TextField(
                        value = search,
                        onValueChange = { search = it },
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Rounded.Search, null) },
                        trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Rounded.Close, "Clear") } },
                        placeholder = { Text("Search history") },
                        modifier = Modifier.fillMaxWidth(),
                        colors = TextFieldDefaults.colors(
                            focusedContainerColor = Color.Transparent,
                            unfocusedContainerColor = Color.Transparent,
                            focusedIndicatorColor = Color.Transparent,
                            unfocusedIndicatorColor = Color.Transparent,
                        ),
                    )
                }
            }
            item {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (failed > 0) AssistChip(onClick = { vm.retryFailed() }, label = { Text("Retry $failed failed") }, leadingIcon = { Icon(Icons.Rounded.Refresh, null, Modifier.size(18.dp)) })
                    AssistChip(onClick = { vm.clearFinished() }, label = { Text("Clear history") }, leadingIcon = { Icon(Icons.Rounded.Delete, null, Modifier.size(18.dp)) })
                }
            }
        }
        if (shown.isEmpty()) {
            item {
                EmptyState(
                    if (showHistory) Icons.Rounded.DownloadDone else Icons.Rounded.Downloading,
                    if (showHistory) (if (search.isNotBlank()) "No matches" else "No finished downloads") else "Nothing downloading",
                    if (showHistory) "Finished and failed downloads show up here, with play and retry." else "Paste a link above, or share a video from the YouTube app to YTD Studio. You can pause and resume any time.",
                )
            }
        }
        items(shown, key = { it.id }) { job ->
            JobCard(
                job,
                onCancel = { vm.cancel(job.id) },
                onRetry = { vm.retry(job.id) },
                onRemove = { vm.remove(job.id) },
                onPause = { vm.pause(job.id) },
                onResume = { vm.resume(job.id) },
                onPrioritize = { vm.prioritize(job.id) },
                onFix = { fix ->
                    when (fix) {
                        ErrorFix.UPDATE_YTDLP -> vm.updateYtdlpAndRetry(job.id)
                        ErrorFix.RETRY -> vm.retry(job.id)
                    }
                },
                onPlay = {
                    job.outputUri?.let {
                        context.startActivity(PlayerActivity.local(context, Uri.parse(it), job.title, job.mode == DownloadMode.VIDEO))
                    }
                },
            )
        }
    }
}

@Composable
private fun SavedPlaylistRow(vm: MainViewModel, saved: SavedPlaylist) {
    var menu by remember { mutableStateOf(false) }
    val busy = saved.id in vm.syncing
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Thumb(saved.thumbnail, Modifier.width(96.dp).aspectRatio(16f / 9f).clip(MaterialTheme.shapes.small))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(saved.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                val what = if (saved.mode == DownloadMode.AUDIO) saved.audioFormat.uppercase() + " audio" else if (saved.height > 0) "up to ${saved.height}p" else "best quality"
                Text(
                    "${saved.knownIds.size} videos · $what · synced ${timeAgo(saved.lastSync)}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = { vm.sync(saved) }, enabled = !busy) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Sync, "Sync now")
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    if (saved.folder != null) {
                        DropdownMenuItem(
                            text = { Text("Open in Library") },
                            leadingIcon = { Icon(Icons.Rounded.Folder, null) },
                            onClick = {
                                menu = false
                                vm.openPlaylist = PlaylistRef.Folder(saved.folder)
                                vm.tab = Tab.LIBRARY
                            },
                        )
                    }
                    DropdownMenuItem(
                        text = { Text("Stop syncing") },
                        leadingIcon = { Icon(Icons.Rounded.SyncDisabled, null) },
                        onClick = { menu = false; vm.library.removeSaved(saved.id) },
                    )
                }
            }
        }
    }
}

@Composable
fun JobCard(
    job: DownloadJob,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onRemove: () -> Unit,
    onPlay: () -> Unit,
    onPause: () -> Unit = {},
    onResume: () -> Unit = {},
    onPrioritize: () -> Unit = {},
    onFix: (ErrorFix) -> Unit = {},
) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.Top) {
            Thumb(job.thumbnail, Modifier.width(104.dp).aspectRatio(16f / 9f).clip(MaterialTheme.shapes.small))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(job.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                if (job.folder != null) {
                    Text(
                        job.folder + (job.playlistIndex?.let { " · #$it" } ?: ""),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.secondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(4.dp))
                val stageColor = when (job.status) {
                    JobStatus.COMPLETED -> Ok
                    JobStatus.FAILED -> MaterialTheme.colorScheme.error
                    JobStatus.CANCELED, JobStatus.PAUSED -> Warn
                    JobStatus.PROCESSING, JobStatus.SAVING -> MaterialTheme.colorScheme.primary
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
                    val help = explainError(job.error)
                    Surface(shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.45f), modifier = Modifier.padding(top = 4.dp)) {
                        Column(Modifier.fillMaxWidth().padding(8.dp)) {
                            if (help != null) {
                                Text(help.title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.error)
                                Text(help.hint, style = MaterialTheme.typography.bodySmall)
                            } else {
                                Text(job.error, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error, maxLines = 4, overflow = TextOverflow.Ellipsis)
                            }
                            help?.fix?.let { fix ->
                                TextButton(onClick = { onFix(fix) }, contentPadding = PaddingValues(horizontal = 0.dp)) {
                                    Text(if (fix == ErrorFix.UPDATE_YTDLP) "Update yt-dlp and retry" else "Retry")
                                }
                            }
                        }
                    }
                }
                if (!job.status.isFinished) {
                    Spacer(Modifier.height(6.dp))
                    // Moving bar while there are no byte counts yet (starting, merging, converting).
                    when {
                        job.status == JobStatus.PAUSED -> LinearProgressIndicator(progress = { job.percent / 100f }, modifier = Modifier.fillMaxWidth(), color = Warn)
                        job.status == JobStatus.DOWNLOADING && job.percent > 0f -> LinearProgressIndicator(progress = { job.percent / 100f }, modifier = Modifier.fillMaxWidth())
                        else -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
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
                    job.status == JobStatus.PAUSED -> IconButton(onClick = onResume) { Icon(Icons.Rounded.PlayArrow, "Resume", tint = MaterialTheme.colorScheme.primary) }
                    job.status == JobStatus.DOWNLOADING || job.status == JobStatus.QUEUED -> IconButton(onClick = onPause) { Icon(Icons.Rounded.Pause, "Pause") }
                    job.status.isFinished -> IconButton(onClick = onRetry) { Icon(Icons.Rounded.Refresh, "Retry") }
                }
                if (job.status == JobStatus.QUEUED) IconButton(onClick = onPrioritize) { Icon(Icons.Rounded.VerticalAlignTop, "Download next") }
                if (!job.status.isFinished) IconButton(onClick = onCancel) { Icon(Icons.Rounded.Close, "Stop") }
                if (job.status.isFinished) IconButton(onClick = onRemove) { Icon(Icons.Rounded.Delete, "Remove from list") }
            }
        }
    }
}
