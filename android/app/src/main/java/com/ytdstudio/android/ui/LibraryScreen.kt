@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.Manifest
import android.app.RecoverableSecurityException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.data.LibraryItem

@Composable
fun LibraryScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val jobs by vm.store.jobs.collectAsStateWithLifecycle()
    val completed = jobs.count { it.status == JobStatus.COMPLETED }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("all") }
    var confirm by remember { mutableStateOf<LibraryItem?>(null) }

    val readPermissions = if (Build.VERSION.SDK_INT >= 33) {
        arrayOf(Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_AUDIO)
    } else {
        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    var canReadAll by remember {
        mutableStateOf(readPermissions.all { ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED })
    }
    val askRead = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        canReadAll = granted.values.all { it }
        vm.refreshLibrary()
    }
    // Files from an earlier install belong to "another app" now, so Android asks the user before deleting.
    val deleteRequest = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { vm.refreshLibrary() }

    LaunchedEffect(completed) { vm.refreshLibrary() }

    val items = vm.library.filter {
        (filter == "all" || (filter == "video") == it.isVideo) && (query.isBlank() || it.title.contains(query, ignoreCase = true))
    }

    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            OutlinedTextField(
                value = query, onValueChange = { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                leadingIcon = { Icon(Icons.Rounded.Search, null) }, placeholder = { Text("Search your downloads") },
            )
        }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("all" to "All", "video" to "Videos", "audio" to "Audio").forEach { (key, label) ->
                    FilterChip(selected = filter == key, onClick = { filter = key }, label = { Text(label) })
                }
            }
        }
        if (!canReadAll) {
            item {
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text("Missing older downloads?", fontWeight = FontWeight.SemiBold)
                        Text(
                            "Android only shows this app the files it saved since it was installed. Allow media access to also list downloads from a previous install.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = { askRead.launch(readPermissions) }) { Text("Allow access") }
                    }
                }
            }
        }
        if (items.isEmpty() && !vm.libraryLoading) {
            item {
                Text(
                    if (vm.library.isEmpty()) "Nothing here yet. Downloads are saved to Movies/YTD Studio and Music/YTD Studio and play offline from here."
                    else "No matches.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 24.dp, horizontal = 8.dp),
                )
            }
        }
        items(items, key = { it.uri.toString() }) { item ->
            LibraryRow(
                item,
                onPlay = { context.startActivity(PlayerActivity.local(context, item.uri, item.title)) },
                onShare = {
                    val send = Intent(Intent.ACTION_SEND).setType(item.mime ?: "*/*").putExtra(Intent.EXTRA_STREAM, item.uri)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    context.startActivity(Intent.createChooser(send, item.title))
                },
                onOpenWith = {
                    val view = Intent(Intent.ACTION_VIEW).setDataAndType(item.uri, item.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    context.startActivity(Intent.createChooser(view, "Open with"))
                },
                onDelete = { confirm = item },
            )
        }
    }

    confirm?.let { item ->
        AlertDialog(
            onDismissRequest = { confirm = null },
            title = { Text("Delete download?") },
            text = { Text(item.name) },
            confirmButton = {
                TextButton(onClick = {
                    confirm = null
                    try {
                        context.contentResolver.delete(item.uri, null, null)
                        vm.refreshLibrary()
                    } catch (e: SecurityException) {
                        val sender = when {
                            Build.VERSION.SDK_INT >= 30 -> MediaStore.createDeleteRequest(context.contentResolver, listOf(item.uri)).intentSender
                            e is RecoverableSecurityException -> e.userAction.actionIntent.intentSender
                            else -> null
                        }
                        if (sender != null) deleteRequest.launch(IntentSenderRequest.Builder(sender).build())
                        else vm.message = "Android did not allow deleting that file."
                    }
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { confirm = null }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun LibraryRow(item: LibraryItem, onPlay: () -> Unit, onShare: () -> Unit, onOpenWith: () -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    Card(Modifier.clickable(onClick = onPlay)) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(112.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(8.dp))) {
                Thumb(item.uri.toString(), Modifier.matchParentSize())
                if (!item.isVideo) Icon(Icons.Rounded.MusicNote, null, modifier = Modifier.align(Alignment.Center))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                val ext = item.name.substringAfterLast('.', "").uppercase()
                Text(
                    listOfNotNull(ext, formatDuration(item.durationMs / 1000.0).takeIf { item.durationMs > 0 }, formatBytes(item.size)).joinToString(" · "),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Play") }, onClick = { menu = false; onPlay() })
                    DropdownMenuItem(text = { Text("Open with...") }, onClick = { menu = false; onOpenWith() })
                    DropdownMenuItem(text = { Text("Share") }, onClick = { menu = false; onShare() })
                    DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; onDelete() })
                }
            }
        }
    }
}
