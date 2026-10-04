@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ContentPaste
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ytdstudio.android.data.DownloadMode

@Composable
fun StreamScreen(vm: MainViewModel) {
    val context = LocalContext.current
    val play = { vm.stream { source -> context.startActivity(PlayerActivity.stream(context, source)) } }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Card {
            Column(Modifier.padding(14.dp)) {
                OutlinedTextField(
                    value = vm.streamUrl,
                    onValueChange = { vm.streamUrl = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("https://youtu.be/...") },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { play() }),
                )
                Spacer(Modifier.height(10.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = vm.streamAudioOnly, onClick = { vm.streamAudioOnly = !vm.streamAudioOnly }, label = { Text("Audio only") })
                    if (!vm.streamAudioOnly) {
                        listOf(1080, 720, 480, 360).forEach { h ->
                            FilterChip(selected = vm.streamHeight == h, onClick = { vm.streamHeight = h }, label = { Text("${h}p") })
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = {
                        val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                        val link = extractUrl(clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString())
                        if (link == null) vm.message = "No link on the clipboard." else {
                            vm.streamUrl = link
                            play()
                        }
                    }) {
                        Icon(Icons.Rounded.ContentPaste, null)
                        Spacer(Modifier.width(6.dp))
                        Text("Paste & play")
                    }
                    Spacer(Modifier.weight(1f))
                    Button(onClick = { play() }, enabled = !vm.streamLoading) {
                        Icon(Icons.Rounded.PlayArrow, null)
                        Spacer(Modifier.width(6.dp))
                        Text(if (vm.streamLoading) "Loading..." else "Play")
                    }
                }
            }
        }
        if (vm.streamLoading) LoadingRow("Asking YouTube for playable streams...")
        vm.streamError?.let { ErrorCard(it) { play() } }
        if (vm.streamUrl.isNotBlank() && !vm.streamLoading) {
            TextButton(onClick = {
                vm.mode = if (vm.streamAudioOnly) DownloadMode.AUDIO else DownloadMode.VIDEO
                vm.tab = Tab.DOWNLOAD
                vm.analyze(vm.streamUrl)
            }) {
                Icon(Icons.Rounded.Download, null)
                Spacer(Modifier.width(6.dp))
                Text("Download this instead (to watch offline)")
            }
        }
        Text(
            "Streams play straight from YouTube without ads and need a connection. To watch offline, download the video; it then plays from the Library tab.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
