@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.PlaylistPlay
import androidx.compose.material.icons.automirrored.rounded.Sort
import androidx.compose.material.icons.automirrored.rounded.ViewList
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.GridView
import androidx.compose.material.icons.rounded.LibraryMusic
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shuffle
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.material.icons.rounded.SyncDisabled
import androidx.compose.material.icons.rounded.VideoLibrary
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab as M3Tab
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.LibraryState

private enum class SortKey(val label: String) { NEWEST("Newest first"), TITLE("Title (A-Z)"), LONGEST("Longest first"), LARGEST("Largest first") }

private fun List<LibraryItem>.sortedByKey(key: SortKey): List<LibraryItem> = when (key) {
    SortKey.NEWEST -> sortedByDescending { it.dateAdded }
    SortKey.TITLE -> sortedBy { it.title.lowercase() }
    SortKey.LONGEST -> sortedByDescending { it.durationMs }
    SortKey.LARGEST -> sortedByDescending { it.size }
}

@Composable
fun LibraryScreen(vm: MainViewModel) {
    val ref = vm.openPlaylist
    if (ref != null) {
        PlaylistDetail(vm, ref)
        return
    }
    val context = LocalContext.current
    val state by vm.library.state.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    var sortName by rememberSaveable { mutableStateOf(SortKey.NEWEST.name) }
    var grid by rememberSaveable { mutableStateOf(true) }
    var sortMenu by remember { mutableStateOf(false) }
    val sort = SortKey.valueOf(sortName)

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

    val matches = vm.items.filter { query.isBlank() || it.title.contains(query, ignoreCase = true) || (it.folder?.contains(query, ignoreCase = true) == true) }
    val videos = matches.filter { it.isVideo }.sortedByKey(sort)
    val music = matches.filter { !it.isVideo }.sortedByKey(sort)
    val favorites = matches.filter { it.key in state.favorites }.sortedByKey(sort)

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.statusBarsPadding().padding(start = 16.dp, end = 4.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Library", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "${vm.items.count { it.isVideo }} videos · ${vm.items.count { !it.isVideo }} audio · ${formatBytes(vm.items.sumOf { it.size })}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (vm.libraryTab == 0) {
                IconButton(onClick = { grid = !grid }) {
                    Icon(if (grid) Icons.AutoMirrored.Rounded.ViewList else Icons.Rounded.GridView, if (grid) "List view" else "Grid view")
                }
            }
            Box {
                IconButton(onClick = { sortMenu = true }) { Icon(Icons.AutoMirrored.Rounded.Sort, "Sort") }
                DropdownMenu(expanded = sortMenu, onDismissRequest = { sortMenu = false }) {
                    SortKey.entries.forEach { key ->
                        DropdownMenuItem(
                            text = { Text(key.label + if (key == sort) "  ✓" else "") },
                            onClick = { sortName = key.name; sortMenu = false },
                        )
                    }
                }
            }
        }
        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            TextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear") } },
                placeholder = { Text("Search your library") },
                modifier = Modifier.fillMaxWidth(),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color.Transparent,
                    unfocusedContainerColor = Color.Transparent,
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                ),
            )
        }
        PrimaryTabRow(selectedTabIndex = vm.libraryTab, containerColor = Color.Transparent) {
            listOf("Videos", "Music", "Playlists", "Favorites").forEachIndexed { index, label ->
                M3Tab(selected = vm.libraryTab == index, onClick = { vm.libraryTab = index }, text = { Text(label) })
            }
        }
        val permissionCard: @Composable () -> Unit = {
            if (!canReadAll) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text("Missing older downloads?", style = MaterialTheme.typography.labelLarge)
                        Text(
                            "Android only shows this app the files it saved since it was installed. Allow media access to also list downloads from a previous install.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { askRead.launch(readPermissions) }) { Text("Allow access") }
                    }
                }
            }
        }
        when (vm.libraryTab) {
            0 -> if (grid) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(164.dp),
                    contentPadding = PaddingValues(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }) { permissionCard() }
                    item(span = { GridItemSpan(maxLineSpan) }) { PlayAllRow(context, videos, "videos") }
                    if (videos.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) { NothingHere(vm, query, Icons.Rounded.VideoLibrary, "No videos yet") }
                    items(videos, key = { it.key }) { item -> MediaTile(item, state, itemActions(context, vm, item, videos)) }
                }
            } else {
                ItemList(vm, state, videos, header = {
                    permissionCard()
                    PlayAllRow(context, videos, "videos")
                }, empty = { NothingHere(vm, query, Icons.Rounded.VideoLibrary, "No videos yet") })
            }
            1 -> ItemList(vm, state, music, header = {
                permissionCard()
                PlayAllRow(context, music, "tracks")
            }, empty = { NothingHere(vm, query, Icons.Rounded.LibraryMusic, "No music yet") })
            2 -> PlaylistsTab(vm, state, query)
            else -> ItemList(vm, state, favorites, header = { PlayAllRow(context, favorites, "favorites") }, empty = {
                EmptyState(Icons.Rounded.FavoriteBorder, "No favorites yet", "Open the menu on any video or song and pick \"Add to favorites\".")
            })
        }
    }
}

@Composable
private fun NothingHere(vm: MainViewModel, query: String, icon: androidx.compose.ui.graphics.vector.ImageVector, title: String) {
    if (vm.libraryLoading && !vm.libraryLoaded) {
        Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    } else if (query.isNotBlank()) {
        EmptyState(Icons.Rounded.Search, "No matches", "Nothing in your library matches \"$query\".")
    } else {
        EmptyState(icon, title, "Paste a link on Home or share a video from the YouTube app. Downloads play offline from here.") {
            TextButton(onClick = { vm.tab = Tab.HOME }) { Text("Add something") }
        }
    }
}

@Composable
private fun PlayAllRow(context: android.content.Context, items: List<LibraryItem>, noun: String) {
    if (items.size < 2) return
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        FilledTonalButton(onClick = { play(context, items) }) {
            Icon(Icons.Rounded.PlayArrow, null)
            Spacer(Modifier.width(6.dp))
            Text("Play all")
        }
        OutlinedButton(onClick = { play(context, items, shuffle = true) }) {
            Icon(Icons.Rounded.Shuffle, null)
            Spacer(Modifier.width(6.dp))
            Text("Shuffle")
        }
        Text("${items.size} $noun", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ItemList(
    vm: MainViewModel,
    state: LibraryState,
    items: List<LibraryItem>,
    header: @Composable () -> Unit,
    empty: @Composable () -> Unit,
) {
    val context = LocalContext.current
    LazyColumn(contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp), modifier = Modifier.fillMaxSize()) {
        item { header() }
        if (items.isEmpty()) item { empty() }
        items(items, key = { it.key }) { item -> MediaRow(item, state, itemActions(context, vm, item, items)) }
    }
}

@Composable
private fun PlaylistsTab(vm: MainViewModel, state: LibraryState, query: String) {
    var creating by remember { mutableStateOf(false) }
    val folders = vm.items.filter { it.folder != null }.groupBy { it.folder!! }
        .filterKeys { query.isBlank() || it.contains(query, ignoreCase = true) }
        .toSortedMap(String.CASE_INSENSITIVE_ORDER)
    val byKey = vm.items.associateBy { it.key }
    val mine = state.playlists.filter { query.isBlank() || it.name.contains(query, ignoreCase = true) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item {
            Button(onClick = { creating = true }) {
                Icon(Icons.Rounded.Add, null)
                Spacer(Modifier.width(6.dp))
                Text("New playlist")
            }
        }
        if (mine.isNotEmpty()) {
            item { SectionHeader("Your playlists") }
            items(mine, key = { it.id }) { p ->
                val list = p.items.mapNotNull { byKey[it] }
                PlaylistRow(p.name, "${list.size} item(s) · " + formatDuration(list.sumOf { it.durationMs } / 1000.0), list.firstOrNull(), list.size) {
                    vm.openPlaylist = PlaylistRef.User(p.id)
                }
            }
        }
        if (folders.isNotEmpty()) {
            item { SectionHeader("Downloaded playlists") }
            items(folders.entries.toList(), key = { "folder:" + it.key }) { (name, list) ->
                val saved = vm.savedFor(name)
                val detail = listOfNotNull("${list.size} item(s)", saved?.let { "synced " + timeAgo(it.lastSync) }).joinToString(" · ")
                PlaylistRow(name, detail, list.minByOrNull { it.name.lowercase() }, list.size) { vm.openPlaylist = PlaylistRef.Folder(name) }
            }
        }
        if (mine.isEmpty() && folders.isEmpty()) {
            item {
                EmptyState(
                    Icons.AutoMirrored.Rounded.PlaylistPlay,
                    "No playlists yet",
                    "Download a YouTube playlist and it shows up here in order, or make your own and add videos and songs from their menu.",
                )
            }
        }
    }
    if (creating) {
        TextInputDialog("New playlist", "", "Create", { name ->
            val id = vm.library.createPlaylist(name)
            creating = false
            vm.openPlaylist = PlaylistRef.User(id)
        }, { creating = false })
    }
}

@Composable
private fun PlaylistRow(title: String, detail: String, first: LibraryItem?, count: Int, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).clickable(onClick = onClick).padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
        PlaylistCover(first, count, Modifier.width(132.dp))
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(detail, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PlaylistDetail(vm: MainViewModel, ref: PlaylistRef) {
    val context = LocalContext.current
    val state by vm.library.state.collectAsStateWithLifecycle()
    val items = vm.playlistItems(ref)
    val title = vm.playlistTitle(ref)
    val saved = (ref as? PlaylistRef.Folder)?.let { vm.savedFor(it.name) }
    var menu by remember { mutableStateOf(false) }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), modifier = Modifier.fillMaxSize()) {
        item {
            Row(Modifier.statusBarsPadding().padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { vm.openPlaylist = null }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back") }
                Spacer(Modifier.weight(1f))
                if (ref is PlaylistRef.User || saved != null) {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            if (ref is PlaylistRef.User) {
                                DropdownMenuItem(text = { Text("Rename") }, leadingIcon = { Icon(Icons.Rounded.Edit, null) }, onClick = { menu = false; renaming = true })
                                DropdownMenuItem(text = { Text("Delete playlist") }, leadingIcon = { Icon(Icons.Rounded.Delete, null) }, onClick = { menu = false; deleting = true })
                            }
                            if (saved != null) {
                                DropdownMenuItem(
                                    text = { Text("Stop syncing") },
                                    leadingIcon = { Icon(Icons.Rounded.SyncDisabled, null) },
                                    onClick = { menu = false; vm.library.removeSaved(saved.id); vm.message = "$title will no longer sync." },
                                )
                            }
                        }
                    }
                }
            }
        }
        item {
            Column(Modifier.padding(horizontal = 16.dp)) {
                PlaylistCover(items.firstOrNull(), items.size, Modifier.fillMaxWidth())
                Spacer(Modifier.height(14.dp))
                Text(title, style = MaterialTheme.typography.headlineSmall)
                val kind = if (ref is PlaylistRef.Folder) "Downloaded playlist" else "Your playlist"
                Text(
                    listOf(kind, "${items.size} item(s)", formatDuration(items.sumOf { it.durationMs } / 1000.0)).joinToString(" · ") +
                        (saved?.let { " · synced " + timeAgo(it.lastSync) } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { play(context, items) }, enabled = items.isNotEmpty()) {
                        Icon(Icons.Rounded.PlayArrow, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Play all")
                    }
                    FilledTonalButton(onClick = { play(context, items, shuffle = true) }, enabled = items.size > 1) {
                        Icon(Icons.Rounded.Shuffle, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Shuffle")
                    }
                    if (saved != null) {
                        val busy = saved.id in vm.syncing
                        OutlinedButton(onClick = { vm.sync(saved) }, enabled = !busy) {
                            if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Sync, null)
                            Spacer(Modifier.width(6.dp))
                            Text("Sync")
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
        if (items.isEmpty()) {
            item {
                EmptyState(
                    Icons.AutoMirrored.Rounded.PlaylistPlay,
                    "This playlist is empty",
                    if (ref is PlaylistRef.User) "Add videos or songs from their menu in the Library." else "Its downloads may still be running.",
                )
            }
        }
        itemsIndexed(items, key = { _, it -> it.key }) { index, item ->
            val user = ref as? PlaylistRef.User
            Box(Modifier.padding(horizontal = 8.dp)) {
                MediaRow(
                    item, state,
                    itemActions(
                        context, vm, item, items,
                        onRemoveFromPlaylist = user?.let { { vm.library.removeFromPlaylist(it.id, item.key) } },
                        onMoveUp = if (user != null && index > 0) ({ vm.library.movePlaylistItem(user.id, index, index - 1) }) else null,
                        onMoveDown = if (user != null && index < items.lastIndex) ({ vm.library.movePlaylistItem(user.id, index, index + 1) }) else null,
                    ),
                    leading = "${index + 1}",
                )
            }
        }
    }

    if (renaming && ref is PlaylistRef.User) {
        TextInputDialog("Rename playlist", title, "Save", { name ->
            vm.library.renamePlaylist(ref.id, name)
            renaming = false
        }, { renaming = false })
    }
    if (deleting && ref is PlaylistRef.User) {
        AlertDialog(
            onDismissRequest = { deleting = false },
            title = { Text("Delete \"$title\"?") },
            text = { Text("Only the playlist is removed. The videos and songs stay in your library.") },
            confirmButton = {
                TextButton(onClick = {
                    vm.library.deletePlaylist(ref.id)
                    deleting = false
                    vm.openPlaylist = null
                }) { Text("Delete") }
            },
            dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } },
        )
    }
}
