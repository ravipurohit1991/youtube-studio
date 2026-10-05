@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)

package com.ytdstudio.android.ui

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.PlaylistAdd
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Favorite
import androidx.compose.material.icons.rounded.FavoriteBorder
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.RemoveCircleOutline
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.VisibilityOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ytdstudio.android.data.LibraryItem
import com.ytdstudio.android.data.LibraryState
import com.ytdstudio.android.data.WatchProgress

/** What can be done with a library item. Null actions are left out of the menu. */
class ItemActions(
    val onPlay: () -> Unit,
    val onToggleFavorite: () -> Unit,
    val onAddToPlaylist: () -> Unit,
    val onToggleWatched: () -> Unit,
    val onShare: () -> Unit,
    val onOpenWith: () -> Unit,
    val onDelete: () -> Unit,
    val onRemoveFromPlaylist: (() -> Unit)? = null,
    val onMoveUp: (() -> Unit)? = null,
    val onMoveDown: (() -> Unit)? = null,
)

/** Standard actions for [item]; [queue] is what plays (in order) when it is tapped. */
fun itemActions(
    context: Context,
    vm: MainViewModel,
    item: LibraryItem,
    queue: List<LibraryItem>,
    shuffle: Boolean = false,
    onRemoveFromPlaylist: (() -> Unit)? = null,
    onMoveUp: (() -> Unit)? = null,
    onMoveDown: (() -> Unit)? = null,
): ItemActions = ItemActions(
    onPlay = { play(context, queue, queue.indexOf(item).coerceAtLeast(0), shuffle) },
    onToggleFavorite = { vm.library.toggleFavorite(item.key) },
    onAddToPlaylist = { vm.addToPlaylist = listOf(item.key) },
    onToggleWatched = {
        val watched = vm.library.progressOf(item.key)?.watched == true
        vm.library.setWatched(item.key, !watched)
    },
    onShare = {
        val send = Intent(Intent.ACTION_SEND).setType(item.mime ?: "*/*").putExtra(Intent.EXTRA_STREAM, item.uri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, item.title))
    },
    onOpenWith = {
        val view = Intent(Intent.ACTION_VIEW).setDataAndType(item.uri, item.mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(view, "Open with"))
    },
    onDelete = { vm.pendingDelete = item },
    onRemoveFromPlaylist = onRemoveFromPlaylist,
    onMoveUp = onMoveUp,
    onMoveDown = onMoveDown,
)

/** Open the player on [items], starting at [start]. */
fun play(context: Context, items: List<LibraryItem>, start: Int = 0, shuffle: Boolean = false) {
    if (items.isEmpty()) return
    val entries = items.map { PlayerActivity.Companion.Entry(it.key, it.title, it.isVideo, it.videoId) }
    val first = if (shuffle) items.indices.random() else start.coerceIn(0, items.lastIndex)
    context.startActivity(PlayerActivity.queue(context, entries, first, shuffle))
}

/** Thumbnail with duration, watched badge and a progress bar for partly watched items. */
@Composable
fun MediaThumb(item: LibraryItem, progress: WatchProgress?, modifier: Modifier = Modifier, compact: Boolean = false) {
    Box(modifier.aspectRatio(16f / 9f).clip(MaterialTheme.shapes.small)) {
        Thumb(item.key, Modifier.matchParentSize())
        if (!item.isVideo) {
            Box(
                Modifier.matchParentSize().background(
                    Brush.linearGradient(listOf(Violet.copy(alpha = 0.55f), Accent.copy(alpha = 0.35f))),
                ),
            )
            Icon(Icons.Rounded.Headphones, null, tint = Color.White, modifier = Modifier.align(Alignment.Center).size(if (compact) 22.dp else 30.dp))
        }
        if (item.durationMs > 0) {
            Text(
                formatDuration(item.durationMs / 1000.0),
                style = MaterialTheme.typography.labelSmall,
                color = Color.White,
                modifier = Modifier.align(Alignment.BottomEnd).padding(5.dp)
                    .background(Color(0xC0000000), RoundedCornerShape(4.dp))
                    .padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
        if (progress?.watched == true) {
            Icon(
                Icons.Rounded.CheckCircle, "Watched", tint = Ok,
                modifier = Modifier.align(Alignment.TopStart).padding(5.dp).size(18.dp).background(Color.White, CircleShape),
            )
        }
        if (progress != null && progress.inProgress) {
            LinearProgressIndicator(
                progress = { progress.fraction },
                modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth().height(3.dp),
                color = MaterialTheme.colorScheme.primary,
                trackColor = Color(0x66000000),
                drawStopIndicator = {},
                gapSize = 0.dp,
            )
        }
    }
}

/** One library item as a list row: thumbnail, title, details, favorite and the menu. */
@Composable
fun MediaRow(item: LibraryItem, state: LibraryState, actions: ItemActions, leading: String? = null) {
    val progress = state.progress[item.key]
    val favorite = item.key in state.favorites
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(MaterialTheme.shapes.medium)
            .combinedClickable(onClick = actions.onPlay, onLongClick = { menu = true })
            .padding(horizontal = 4.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (leading != null) {
            Text(leading, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(26.dp), textAlign = TextAlign.Center)
        }
        MediaThumb(item, progress, Modifier.width(132.dp), compact = true)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(2.dp))
            Text(itemDetails(item, progress), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        if (favorite) Icon(Icons.Rounded.Favorite, "Favorite", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
            ItemMenu(menu, { menu = false }, actions, favorite, progress?.watched == true)
        }
    }
}

/** A large card for carousels and grids. */
@Composable
fun MediaTile(item: LibraryItem, state: LibraryState, actions: ItemActions, modifier: Modifier = Modifier) {
    val progress = state.progress[item.key]
    val favorite = item.key in state.favorites
    var menu by remember { mutableStateOf(false) }
    Column(
        modifier
            .clip(MaterialTheme.shapes.medium)
            .combinedClickable(onClick = actions.onPlay, onLongClick = { menu = true })
            .padding(4.dp),
    ) {
        MediaThumb(item, progress, Modifier.fillMaxWidth())
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(item.title, maxLines = 2, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                Text(itemDetails(item, progress), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(28.dp)) { Icon(Icons.Rounded.MoreVert, "More", modifier = Modifier.size(18.dp)) }
                ItemMenu(menu, { menu = false }, actions, favorite, progress?.watched == true)
            }
        }
    }
}

private fun itemDetails(item: LibraryItem, progress: WatchProgress?): String {
    val ext = item.name.substringAfterLast('.', "").uppercase()
    val left = progress?.takeIf { it.inProgress }?.let { formatDuration((it.durationMs - it.positionMs) / 1000.0) + " left" }
    return listOfNotNull(left, ext, formatBytes(item.size)).joinToString(" · ")
}

@Composable
private fun ItemMenu(expanded: Boolean, onDismiss: () -> Unit, actions: ItemActions, favorite: Boolean, watched: Boolean) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        MenuEntry("Play", Icons.Rounded.PlayArrow) { onDismiss(); actions.onPlay() }
        MenuEntry(if (favorite) "Remove from favorites" else "Add to favorites", if (favorite) Icons.Rounded.Favorite else Icons.Rounded.FavoriteBorder) {
            onDismiss(); actions.onToggleFavorite()
        }
        MenuEntry("Add to playlist", Icons.AutoMirrored.Rounded.PlaylistAdd) { onDismiss(); actions.onAddToPlaylist() }
        MenuEntry(if (watched) "Mark as unwatched" else "Mark as watched", if (watched) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility) {
            onDismiss(); actions.onToggleWatched()
        }
        actions.onMoveUp?.let { MenuEntry("Move up", Icons.Rounded.KeyboardArrowUp) { onDismiss(); it() } }
        actions.onMoveDown?.let { MenuEntry("Move down", Icons.Rounded.KeyboardArrowDown) { onDismiss(); it() } }
        actions.onRemoveFromPlaylist?.let { MenuEntry("Remove from this playlist", Icons.Rounded.RemoveCircleOutline) { onDismiss(); it() } }
        HorizontalDivider()
        MenuEntry("Share", Icons.Rounded.Share) { onDismiss(); actions.onShare() }
        MenuEntry("Open with...", Icons.AutoMirrored.Rounded.OpenInNew) { onDismiss(); actions.onOpenWith() }
        MenuEntry("Delete file", Icons.Rounded.Delete) { onDismiss(); actions.onDelete() }
    }
}

@Composable
private fun MenuEntry(label: String, icon: ImageVector, onClick: () -> Unit) {
    DropdownMenuItem(text = { Text(label) }, leadingIcon = { Icon(icon, null) }, onClick = onClick)
}

@Composable
fun SectionHeader(title: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, message: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(64.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, null, tint = MaterialTheme.colorScheme.onPrimaryContainer, modifier = Modifier.size(30.dp)) }
        }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

/** Square-ish cover for a playlist: the first item's thumbnail with the item count on top. */
@Composable
fun PlaylistCover(first: LibraryItem?, count: Int, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(16f / 9f).clip(MaterialTheme.shapes.medium).background(MaterialTheme.colorScheme.surfaceContainerHighest)) {
        if (first != null) Thumb(first.key, Modifier.matchParentSize())
        Box(
            Modifier.align(Alignment.CenterEnd).fillMaxWidth(0.38f).fillMaxHeight()
                .background(Color(0xB3000000)),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("$count", color = Color.White, style = MaterialTheme.typography.titleLarge)
                Icon(Icons.AutoMirrored.Rounded.PlaylistAdd, null, tint = Color.White, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun TextInputDialog(title: String, initial: String, confirm: String, onConfirm: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(text, { text = it }, singleLine = true, placeholder = { Text("Name") }) },
        confirmButton = { TextButton(onClick = { onConfirm(text) }, enabled = text.isNotBlank()) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

/** Pick one of the user's playlists (or make a new one) for [keys]. */
@Composable
fun AddToPlaylistDialog(vm: MainViewModel, state: LibraryState, keys: List<String>, onDismiss: () -> Unit) {
    var creating by remember { mutableStateOf(state.playlists.isEmpty()) }
    if (creating) {
        TextInputDialog("New playlist", "", "Create", { name ->
            vm.library.createPlaylist(name, keys)
            vm.message = "Added to $name."
            onDismiss()
        }, onDismiss)
        return
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Add to playlist") },
        text = {
            LazyColumn {
                item {
                    ListItem(
                        headlineContent = { Text("New playlist") },
                        leadingContent = { Icon(Icons.Rounded.Add, null) },
                        modifier = Modifier.clickable { creating = true },
                    )
                }
                items(state.playlists, key = { it.id }) { p ->
                    val already = keys.all { it in p.items }
                    ListItem(
                        headlineContent = { Text(p.name) },
                        supportingContent = { Text("${p.items.size} item(s)") },
                        leadingContent = { Icon(if (already) Icons.Rounded.TaskAlt else Icons.AutoMirrored.Rounded.PlaylistAdd, null) },
                        modifier = Modifier.clickable {
                            vm.library.addToPlaylist(p.id, keys)
                            vm.message = "Added to ${p.name}."
                            onDismiss()
                        },
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("Close") } },
    )
}
