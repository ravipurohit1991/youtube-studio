@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.os.Build
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.BuildConfig
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.data.Settings
import com.ytdstudio.android.data.ThemeMode
import com.ytdstudio.android.engine.Engine

@Composable
fun SettingsScreen(vm: MainViewModel) {
    val settings by vm.prefs.settings.collectAsStateWithLifecycle()
    val engine by Engine.state.collectAsStateWithLifecycle()
    fun set(transform: (Settings) -> Settings) = vm.prefs.update(transform)
    Column(
        Modifier.verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)

        Section("Appearance", Icons.Rounded.Palette) {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                ThemeMode.entries.forEachIndexed { i, mode ->
                    SegmentedButton(
                        selected = settings.themeMode == mode,
                        onClick = { set { it.copy(themeMode = mode) } },
                        shape = SegmentedButtonDefaults.itemShape(i, ThemeMode.entries.size),
                    ) { Text(mode.name.lowercase().replaceFirstChar { it.uppercase() }) }
                }
            }
            if (Build.VERSION.SDK_INT >= 31) {
                Toggle("Colors from your wallpaper", "Material You colors instead of the YTD Studio red.", settings.dynamicColor) { on ->
                    set { it.copy(dynamicColor = on) }
                }
            }
        }

        Section("Playback", Icons.Rounded.PlayCircle) {
            Toggle("Resume where you left off", "Videos and songs continue from the last position.", settings.resumePlayback) { on ->
                set { it.copy(resumePlayback = on) }
            }
            Toggle("Picture-in-picture", "Leaving the player while a video plays keeps it in a small floating window.", settings.pictureInPicture) { on ->
                set { it.copy(pictureInPicture = on) }
            }
            Toggle("Background play for videos", "Keep the sound of a video going after you leave the player. Music always plays in the background.", settings.backgroundVideo) { on ->
                set { it.copy(backgroundVideo = on) }
            }
        }

        Section("Downloads", Icons.Rounded.Download) {
            Label("Default content")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(settings.defaultMode == DownloadMode.VIDEO, { set { it.copy(defaultMode = DownloadMode.VIDEO) } }, { Text("Video + audio") })
                FilterChip(settings.defaultMode == DownloadMode.AUDIO, { set { it.copy(defaultMode = DownloadMode.AUDIO) } }, { Text("Audio only") })
            }
            Label("Video quality (up to)")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.HEIGHTS.forEach { h ->
                    FilterChip(settings.preferredHeight == h, { set { it.copy(preferredHeight = h) } }, { Text(if (h == 0) "Best" else "${h}p") })
                }
            }
            Hint("Above 1080p YouTube only offers VP9/AV1. Recent phones play them; older ones may stutter. Streams are capped at 1080p.")
            Label("Audio format")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.AUDIO_FORMATS.forEach { f ->
                    FilterChip(settings.audioFormat == f, { set { it.copy(audioFormat = f) } }, { Text(f.uppercase()) })
                }
            }
            Label("Downloads at once")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (1..3).forEach { n -> FilterChip(settings.concurrentDownloads == n, { set { it.copy(concurrentDownloads = n) } }, { Text("$n") }) }
            }
            Toggle("A folder per playlist", "Playlist downloads go into their own folder, in playlist order, and show up as playlists in the Library.", settings.playlistFolders) { on ->
                set { it.copy(playlistFolders = on) }
            }
            Hint("Saved to ${MediaLibrary.folderLabel(true)} (video) and ${MediaLibrary.folderLabel(false)} (audio). Files stay on the phone even if the app is removed.")
        }

        Section("yt-dlp", Icons.Rounded.Build) {
            val version = when (val s = engine) {
                is Engine.State.Ready -> s.version ?: "unknown"
                is Engine.State.Updating -> s.message
                is Engine.State.Preparing -> "preparing..."
                is Engine.State.Failed -> s.message
            }
            Text("Version: $version", style = MaterialTheme.typography.bodyMedium)
            Hint("YouTube changes often; an outdated yt-dlp is the most common reason downloads fail. The app checks GitHub for a new release twice a day.")
            Toggle("Update automatically", null, settings.autoUpdateYtdlp) { on -> set { it.copy(autoUpdateYtdlp = on) } }
            FilledTonalButton(onClick = { Engine.updateYtdlp() }, enabled = engine is Engine.State.Ready) { Text("Check for update now") }
        }

        Section("About", Icons.Rounded.Info) {
            Text("YTD Studio ${BuildConfig.VERSION_NAME} (build ${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.bodyMedium)
            Hint(
                "Uses yt-dlp (Unlicense), Python, FFmpeg and QuickJS, bundled through youtubedl-android (GPL-3.0). " +
                    "Only download content you have the right to.",
            )
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun Section(title: String, icon: ImageVector, content: @Composable () -> Unit) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            content()
        }
    }
}

@Composable
private fun Toggle(title: String, hint: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            if (hint != null) Hint(hint)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Label(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 2.dp))
}

@Composable
private fun Hint(text: String) {
    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
