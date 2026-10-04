@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.BuildConfig
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.engine.Engine

@Composable
fun SettingsScreen(vm: MainViewModel) {
    val settings by vm.prefs.settings.collectAsStateWithLifecycle()
    val engine by Engine.state.collectAsStateWithLifecycle()
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Section("Defaults") {
            Label("Download")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(settings.defaultMode == DownloadMode.VIDEO, { set(vm) { it.copy(defaultMode = DownloadMode.VIDEO) }; vm.mode = DownloadMode.VIDEO }, { Text("Video + audio") })
                FilterChip(settings.defaultMode == DownloadMode.AUDIO, { set(vm) { it.copy(defaultMode = DownloadMode.AUDIO) }; vm.mode = DownloadMode.AUDIO }, { Text("Audio only") })
            }
            Label("Video quality (up to)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.HEIGHTS.forEach { h ->
                    FilterChip(settings.preferredHeight == h, { set(vm) { it.copy(preferredHeight = h) }; vm.height = h }, { Text(if (h == 0) "Best" else "${h}p") })
                }
            }
            Hint("Above 1080p YouTube only offers VP9/AV1. Recent phones play them; older ones may stutter.")
            Label("Audio format")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.AUDIO_FORMATS.forEach { f ->
                    FilterChip(settings.audioFormat == f, { set(vm) { it.copy(audioFormat = f) }; vm.audioFormat = f }, { Text(f.uppercase()) })
                }
            }
            Label("Downloads at once")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..3).forEach { n -> FilterChip(settings.concurrentDownloads == n, { set(vm) { it.copy(concurrentDownloads = n) } }, { Text("$n") }) }
            }
            Hint("Saved to ${MediaLibrary.folderLabel(true)} (video) and ${MediaLibrary.folderLabel(false)} (audio).")
        }

        Section("yt-dlp") {
            val version = when (val s = engine) {
                is Engine.State.Ready -> s.version ?: "unknown"
                is Engine.State.Updating -> s.message
                is Engine.State.Preparing -> "preparing..."
                is Engine.State.Failed -> s.message
            }
            Text("Version: $version", style = MaterialTheme.typography.bodyMedium)
            Hint("YouTube changes often; an outdated yt-dlp is the most common reason downloads fail. The app checks GitHub for a new release twice a day.")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Update automatically", modifier = Modifier.weight(1f))
                Switch(checked = settings.autoUpdateYtdlp, onCheckedChange = { on -> set(vm) { it.copy(autoUpdateYtdlp = on) } })
            }
            Button(onClick = { Engine.updateYtdlp() }, enabled = engine is Engine.State.Ready) { Text("Check for update now") }
        }

        Section("About") {
            Text("YTD Studio ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.bodyMedium)
            Hint(
                "Uses yt-dlp (Unlicense), Python, FFmpeg and QuickJS, bundled through youtubedl-android (GPL-3.0). " +
                    "Only download content you have the right to.",
            )
        }
    }
}

private fun set(vm: MainViewModel, transform: (com.ytdstudio.android.data.Settings) -> com.ytdstudio.android.data.Settings) = vm.prefs.update(transform)

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
private fun Label(text: String) {
    Spacer(Modifier.height(2.dp))
    Text(text, style = MaterialTheme.typography.labelLarge)
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
