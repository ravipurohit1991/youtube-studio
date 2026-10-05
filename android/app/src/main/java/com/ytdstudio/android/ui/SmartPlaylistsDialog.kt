package com.ytdstudio.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Let the model sort the library into themed playlists; nothing is created until confirmed. */
@Composable
fun SmartPlaylistsDialog(vm: MainViewModel, ai: AiViewModel, onDismiss: () -> Unit) {
    LaunchedEffect(Unit) { ai.organize() }
    val groups = ai.groups
    var chosen by remember(groups) { mutableStateOf(groups?.indices?.toSet() ?: emptySet()) }
    val titles = vm.items.associate { it.key to it.title }
    val close = {
        ai.cancelOrganize()
        onDismiss()
    }
    AlertDialog(
        onDismissRequest = close,
        title = { Text("Smart playlists") },
        text = {
            when {
                ai.organizing -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(12.dp))
                    Text(ai.organizeStage ?: "Starting…")
                }
                ai.organizeError != null -> Text(ai.organizeError ?: "", color = MaterialTheme.colorScheme.error)
                groups != null -> LazyColumn(Modifier.heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    item {
                        Text("Pick the playlists to create. You can rename or edit them afterwards.", style = MaterialTheme.typography.bodySmall)
                    }
                    itemsIndexed(groups) { i, g ->
                        Row(
                            Modifier.fillMaxWidth().clickable { chosen = if (i in chosen) chosen - i else chosen + i }.padding(vertical = 4.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Checkbox(checked = i in chosen, onCheckedChange = null, modifier = Modifier.padding(end = 8.dp))
                            Column(Modifier.weight(1f)) {
                                Text(g.name + " · ${g.keys.size}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                                if (g.description.isNotEmpty()) Text(g.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text(
                                    g.keys.take(4).joinToString(" · ") { titles[it] ?: "?" } + if (g.keys.size > 4) " …" else "",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                }
                else -> Text("Starting…")
            }
        },
        confirmButton = {
            if (groups != null) {
                TextButton(onClick = {
                    ai.createPlaylists(groups.filterIndexed { i, _ -> i in chosen })
                    onDismiss()
                }, enabled = chosen.isNotEmpty()) { Text("Create ${chosen.size}") }
            } else if (ai.organizeError != null) {
                TextButton(onClick = { ai.organize() }) { Text("Try again") }
            }
        },
        dismissButton = {
            Row {
                if (groups != null) TextButton(onClick = { ai.organize() }) { Text("Regroup") }
                TextButton(onClick = close) { Text("Cancel") }
            }
        },
    )
}
