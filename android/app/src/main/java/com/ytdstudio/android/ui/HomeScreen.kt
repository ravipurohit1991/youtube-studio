package com.ytdstudio.android.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.JobStatus
import com.ytdstudio.android.data.LibraryItem

@Composable
fun HomeScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val state by vm.library.state.collectAsStateWithLifecycle()
    val jobs by vm.store.jobs.collectAsStateWithLifecycle()
    val items = vm.items
    val active = jobs.filter { it.status == JobStatus.QUEUED || it.status.isActive }
    val continueWatching = items
        .mapNotNull { item -> state.progress[item.key]?.takeIf { it.inProgress }?.let { item to it.updatedAt } }
        .sortedByDescending { it.second }
        .map { it.first }
        .take(15)
    val recent = items.take(15)
    val favorites = items.filter { it.key in state.favorites }.take(15)
    val folderPlaylists = items.filter { it.folder != null }.groupBy { it.folder!! }
    val playlistCards = folderPlaylists.map { (name, list) -> Triple<PlaylistRef, String, List<LibraryItem>>(PlaylistRef.Folder(name), name, list.sortedBy { it.name.lowercase() }) } +
        state.playlists.map { p ->
            val byKey = items.associateBy { it.key }
            Triple<PlaylistRef, String, List<LibraryItem>>(PlaylistRef.User(p.id), p.name, p.items.mapNotNull { byKey[it] })
        }

    val streams by vm.prefs.streams.collectAsStateWithLifecycle()
    val totalSeconds = items.sumOf { it.durationMs } / 1000.0

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item { Hero(vm) }
        if (items.isNotEmpty() || state.saved.isNotEmpty()) {
            item {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    StatTile(Icons.Rounded.VideoLibrary, "${items.size}", if (items.size == 1) "item" else "items", Modifier.weight(1f)) { vm.tab = Tab.LIBRARY }
                    StatTile(Icons.Rounded.Schedule, formatHours(totalSeconds), "offline", Modifier.weight(1f)) { vm.tab = Tab.LIBRARY }
                    StatTile(Icons.Rounded.Sync, "${state.saved.size}", "followed", Modifier.weight(1f)) { vm.tab = Tab.DOWNLOADS }
                }
            }
        }
        item {
            Surface(
                onClick = { vm.tab = Tab.DISCOVER },
                shape = MaterialTheme.shapes.large,
                color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            ) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(36.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Accent, Violet))), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.AutoAwesome, null, tint = Color.White, modifier = Modifier.size(20.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Discover with AI", style = MaterialTheme.typography.labelLarge)
                        Text(
                            "Say what you want to watch; your own algorithm finds and ranks it.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        if (active.isNotEmpty()) {
            item {
                val lead = active.firstOrNull { it.status.isActive } ?: active.first()
                Surface(
                    onClick = { vm.tab = Tab.DOWNLOADS },
                    shape = MaterialTheme.shapes.large,
                    color = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Download, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                            Spacer(Modifier.width(10.dp))
                            Text(
                                if (active.size == 1) "Downloading 1 item" else "Downloading ${active.size} items",
                                style = MaterialTheme.typography.labelLarge,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                                modifier = Modifier.weight(1f),
                            )
                            Text("View", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(lead.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        Spacer(Modifier.height(6.dp))
                        if (lead.status == JobStatus.DOWNLOADING && lead.percent > 0f) {
                            LinearProgressIndicator(progress = { lead.percent / 100f }, modifier = Modifier.fillMaxWidth())
                        } else {
                            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
        if (continueWatching.isNotEmpty()) {
            item { SectionHeader("Continue watching", Modifier.padding(horizontal = 16.dp)) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(continueWatching, key = { it.key }) { item ->
                        MediaTile(item, state, itemActions(context, vm, item, listOf(item)), Modifier.width(228.dp))
                    }
                }
            }
        }
        if (recent.isNotEmpty()) {
            item { SectionHeader("Recently added", Modifier.padding(start = 16.dp, end = 4.dp), "See all") { vm.libraryTab = 0; vm.tab = Tab.LIBRARY } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(recent, key = { it.key }) { item ->
                        MediaTile(item, state, itemActions(context, vm, item, recent), Modifier.width(196.dp))
                    }
                }
            }
        }
        if (playlistCards.isNotEmpty()) {
            item { SectionHeader("Playlists", Modifier.padding(start = 16.dp, end = 4.dp), "See all") { vm.libraryTab = 2; vm.tab = Tab.LIBRARY } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(playlistCards, key = { it.first.toString() }) { (ref, name, list) ->
                        Column(
                            Modifier.width(196.dp).clip(MaterialTheme.shapes.medium).clickable {
                                vm.openPlaylist = ref
                                vm.tab = Tab.LIBRARY
                            },
                        ) {
                            PlaylistCover(list.firstOrNull(), list.size)
                            Text(name, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                            Text(
                                if (ref is PlaylistRef.Folder) "Downloaded playlist" else "Your playlist",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
        if (streams.isNotEmpty()) {
            item { SectionHeader("Recently streamed", Modifier.padding(start = 16.dp, end = 4.dp), "Clear") { vm.prefs.clearStreams() } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(streams.take(15), key = { "s:" + it.url }) { entry ->
                        Column(
                            Modifier.width(196.dp).clip(MaterialTheme.shapes.medium).clickable {
                                vm.watch(entry.url, entry.title, entry.thumbnail, false) { source, thumb ->
                                    context.startActivity(PlayerActivity.stream(context, source, thumb))
                                }
                            },
                        ) {
                            Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(MaterialTheme.shapes.small)) {
                                Thumb(entry.thumbnail, Modifier.matchParentSize())
                                if (vm.resolvingStream == entry.url) {
                                    Box(Modifier.matchParentSize().background(Color(0x88000000)), contentAlignment = Alignment.Center) {
                                        CircularProgressIndicator(Modifier.size(24.dp), color = Color.White, strokeWidth = 2.dp)
                                    }
                                }
                            }
                            Text(entry.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
                            Text(
                                listOfNotNull(entry.uploader, timeAgo(entry.at)).joinToString(" · "),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
        }
        if (favorites.isNotEmpty()) {
            item { SectionHeader("Favorites", Modifier.padding(start = 16.dp, end = 4.dp), "See all") { vm.libraryTab = 3; vm.tab = Tab.LIBRARY } }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    items(favorites, key = { it.key }) { item ->
                        MediaTile(item, state, itemActions(context, vm, item, favorites), Modifier.width(196.dp))
                    }
                }
            }
        }
        if (items.isEmpty() && vm.libraryLoaded) {
            item { GettingStarted() }
        }
    }
}

@Composable
private fun Hero(vm: MainViewModel) {
    val scheme = MaterialTheme.colorScheme
    Box(
        Modifier.fillMaxWidth().background(
            Brush.verticalGradient(listOf(scheme.primary.copy(alpha = 0.22f), scheme.secondary.copy(alpha = 0.08f), Color.Transparent)),
        ),
    ) {
        Column(Modifier.statusBarsPadding().padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(42.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Accent, Violet))),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.PlayArrow, null, tint = Color.White)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(greeting(), style = MaterialTheme.typography.headlineSmall)
                    Text("Paste a link to watch or save it", style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(18.dp))
            LinkBar(vm)
            ClipboardChip(vm)
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Share, null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    "Tip: in the YouTube app, tap Share and pick YTD Studio.",
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** The one input of the app: paste a video or playlist link, then watch or download it. */
@Composable
fun LinkBar(vm: MainViewModel, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerHighest, modifier = modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 14.dp, end = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Link, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            TextField(
                value = vm.url,
                onValueChange = { vm.url = it },
                singleLine = true,
                placeholder = { Text("Paste a video or playlist link") },
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { vm.analyze() }),
            )
            if (vm.url.isEmpty()) {
                IconButton(onClick = {
                    val link = clipboardLink(context)
                    if (link == null) vm.message = "No link on the clipboard." else vm.analyze(link)
                }) { Icon(Icons.Rounded.ContentPaste, "Paste") }
            } else {
                IconButton(onClick = { vm.url = "" }) { Icon(Icons.Rounded.Close, "Clear") }
                FilledIconButton(onClick = { vm.analyze() }) { Icon(Icons.AutoMirrored.Rounded.ArrowForward, "Go") }
            }
        }
    }
}

/**
 * Offers the clipboard when it holds text. Only the clip's type is checked here, so Android does not
 * show its "pasted from your clipboard" notice until the chip is tapped.
 */
@Composable
private fun ClipboardChip(vm: MainViewModel) {
    val context = LocalContext.current
    var hasText by remember { mutableStateOf(false) }
    LaunchedEffect(vm.tab, vm.sheetOpen) {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        hasText = clipboard.hasPrimaryClip() && clipboard.primaryClipDescription?.hasMimeType("text/*") == true
    }
    if (!hasText || vm.url.isNotEmpty()) return
    AssistChip(
        onClick = {
            val link = clipboardLink(context)
            if (link == null) {
                vm.message = "There is no link on the clipboard."
                hasText = false
            } else vm.analyze(link)
        },
        label = { Text("Paste the copied link") },
        leadingIcon = { Icon(Icons.Rounded.ContentPaste, null, Modifier.size(18.dp)) },
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun StatTile(icon: ImageVector, value: String, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Surface(onClick = onClick, shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = modifier) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            Spacer(Modifier.height(6.dp))
            Text(value, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

fun clipboardLink(context: Context): String? {
    val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
    return extractUrl(clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString())
}

@Composable
private fun GettingStarted() {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("Get started", style = MaterialTheme.typography.titleMedium)
        Step(Icons.Rounded.Link, "Paste a link", "Any YouTube video or playlist. Watch it right away without ads, or download it.")
        Step(Icons.Rounded.Download, "Download whole playlists", "One tap saves every video into its own folder, and Sync fetches new ones later.")
        Step(Icons.Rounded.VideoLibrary, "Watch and organize", "Your library remembers where you stopped. Make playlists and favorites, play in the background.")
    }
}

@Composable
private fun Step(icon: ImageVector, title: String, text: String) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(40.dp)) {
                Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = MaterialTheme.colorScheme.onPrimaryContainer) }
            }
            Spacer(Modifier.width(14.dp))
            Column {
                Text(title, style = MaterialTheme.typography.labelLarge)
                Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
