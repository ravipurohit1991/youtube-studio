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
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material.icons.rounded.Sync
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Save
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.PlayCircle
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
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
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import com.ytdstudio.android.ai.AiCore
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.BuildConfig
import com.ytdstudio.android.ai.Ai
import com.ytdstudio.android.data.DownloadMode
import com.ytdstudio.android.data.MediaLibrary
import com.ytdstudio.android.data.Prefs
import com.ytdstudio.android.data.Settings
import com.ytdstudio.android.data.ThemeMode
import com.ytdstudio.android.engine.Engine

@Composable
fun SettingsScreen(vm: MainViewModel, ai: AiViewModel) {
    val settings by vm.prefs.settings.collectAsStateWithLifecycle()
    val engine by Engine.state.collectAsStateWithLifecycle()
    fun set(transform: (Settings) -> Settings) = vm.prefs.update(transform)
    Column(
        Modifier.verticalScroll(rememberScrollState()).statusBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium)

        AiSection(ai, settings)

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
            if (!settings.dynamicColor) {
                Label("Accent color")
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ACCENTS.forEach { (id, spec) ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Box(
                                Modifier.size(38.dp).clip(CircleShape).background(spec.base).clickable { set { it.copy(accent = id) } },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (settings.accent == id) Icon(Icons.Rounded.Check, spec.label, tint = Color.White, modifier = Modifier.size(20.dp))
                            }
                            Text(spec.label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (Build.VERSION.SDK_INT >= 31) {
                Toggle("Colors from your wallpaper", "Material You colors instead of the accent above.", settings.dynamicColor) { on ->
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
            Label("Video codec")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(settings.videoCodec == "compatible", { set { it.copy(videoCodec = "compatible") } }, { Text("Compatible (H.264)") })
                FilterChip(settings.videoCodec == "best", { set { it.copy(videoCodec = "best") } }, { Text("Best quality") })
            }
            Hint("Compatible plays on every phone and TV. Best quality allows VP9/AV1, often sharper but harder on older phones.")
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
            Label("Speed limit")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.RATE_LIMITS.forEach { r ->
                    FilterChip(settings.rateLimit == r, { set { it.copy(rateLimit = r) } }, { Text(if (r.isEmpty()) "Unlimited" else r.replace("K", " KB/s").replace("M", " MB/s")) })
                }
            }
            Toggle("Skip sponsors by default", "SponsorBlock cuts sponsor, self-promotion and \"subscribe\" segments out of downloads.", settings.sponsorBlock) { on ->
                set { it.copy(sponsorBlock = on) }
            }
            Toggle("Embed tags and chapters", "Players show the title, channel and chapters of downloaded videos.", settings.embedMetadata) { on ->
                set { it.copy(embedMetadata = on) }
            }
            Toggle("A folder per playlist", "Playlist downloads go into their own folder, in playlist order, and show up as playlists in the Library.", settings.playlistFolders) { on ->
                set { it.copy(playlistFolders = on) }
            }
            Hint("Saved to ${MediaLibrary.folderLabel(true)} (video) and ${MediaLibrary.folderLabel(false)} (audio). Files stay on the phone even if the app is removed.")
        }

        Section("Follow and sync", Icons.Rounded.Sync) {
            Hint("Playlists and channels you keep in sync get only their new videos on Sync. Auto-sync does it when you open the app.")
            Label("Auto-sync")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Prefs.SYNC_HOURS.forEach { h ->
                    FilterChip(settings.autoSyncHours == h, { set { it.copy(autoSyncHours = h) } }, { Text(if (h == 0) "Off" else if (h == 24) "Daily" else "Every $h h") })
                }
            }
        }

        BackupSection(vm)

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

/** Save or restore favorites, progress, playlists, followed playlists, AI feedback and settings. */
@Composable
private fun BackupSection(vm: MainViewModel) {
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri -> uri?.let { vm.exportBackup(it) } }
    val open = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { vm.importBackup(it) } }
    Section("Backup", Icons.Rounded.Restore) {
        Hint("One file with your favorites, watch progress, playlists, followed playlists, AI feedback and settings. Restoring merges it in; the AI key is never included.")
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            FilledTonalButton(onClick = { save.launch("ytd-studio-backup.json") }) { Text("Save a backup") }
            OutlinedButton(onClick = { open.launch(arrayOf("application/json", "text/plain", "*/*")) }) { Text("Restore") }
        }
    }
}

/** Ollama connection: server, API key (Android Keystore), model, and Discover defaults. */
@Composable
private fun AiSection(ai: AiViewModel, settings: Settings) {
    val status = ai.status
    var host by remember(status.host) { mutableStateOf(status.host) }
    var key by remember { mutableStateOf("") }
    var replacing by remember { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    val canList = status.hasKey || !status.isCloud
    LaunchedEffect(status.host, status.keyHint) {
        if (canList && ai.models.isEmpty()) ai.loadModels(quiet = true)
    }
    Section("AI (Ollama)", Icons.Rounded.AutoAwesome) {
        Text(
            when {
                status.ready -> "Ready · " + status.model
                status.isCloud && !status.hasKey -> "Add your Ollama API key to turn on Discover, summaries and smart playlists."
                else -> "Pick a model to finish."
            },
            style = MaterialTheme.typography.bodyMedium,
            color = if (status.ready) Ok else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Label("Server")
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(host, { host = it }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
            IconButton(onClick = { ai.setHost(host) }, enabled = host.trim().trimEnd('/') != status.host) { Icon(Icons.Rounded.Save, "Save server") }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(status.isCloud, { ai.setHost(AiCore.CLOUD_HOST) }, { Text("Ollama Cloud") })
        }
        Hint("Or your own Ollama, e.g. http://192.168.1.20:11434 (start it with OLLAMA_HOST=0.0.0.0). The key is never sent over plain HTTP to another machine.")

        Label(if (status.isCloud) "API key" else "API key (optional; used for web search)")
        if (status.hasKey && !replacing) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Key, null, tint = Ok, modifier = Modifier.size(18.dp))
                Text("Saved ····" + status.keyHint, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                TextButton(onClick = { replacing = true }) { Text("Replace") }
                TextButton(onClick = { ai.clearKey() }) { Text("Remove", color = MaterialTheme.colorScheme.error) }
            }
            Hint("Encrypted with the Android Keystore; only sent to your AI server and Ollama web search.")
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    key, { key = it },
                    singleLine = true,
                    placeholder = { Text("Paste your Ollama API key") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                Button(onClick = { if (ai.saveKey(key)) { key = ""; replacing = false } }, enabled = key.isNotBlank()) { Text("Save") }
            }
            Hint("Create one at ollama.com/settings/keys.")
        }

        Label("Model")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) {
                OutlinedButton(onClick = { modelMenu = true }, enabled = ai.models.isNotEmpty(), modifier = Modifier.fillMaxWidth()) {
                    Text(status.model.ifBlank { if (canList) "Choose a model" else "Save your API key first" }, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                    ai.models.forEach { m ->
                        DropdownMenuItem(
                            text = { Text(m.name + (m.parameterSize?.let { "  ($it)" } ?: "")) },
                            onClick = { modelMenu = false; ai.setModel(m.name) },
                        )
                    }
                }
            }
            IconButton(onClick = { ai.loadModels() }, enabled = canList && !ai.modelsLoading) {
                if (ai.modelsLoading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Rounded.Refresh, "Refresh the model list")
            }
        }
        ai.modelsError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilledTonalButton(onClick = { ai.test() }, enabled = status.ready && !ai.testing) {
                if (ai.testing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Test connection")
            }
            Spacer(Modifier.width(10.dp))
            ai.testResult?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Ok, modifier = Modifier.weight(1f)) }
        }
        Hint("Bigger models rank and summarize better; smaller ones answer faster.")
        Toggle("Personalize Discover", "Use your downloads, favorites and thumbs up/down as a taste profile.", settings.aiPersonalize) { on ->
            Ai.prefs.update { it.copy(aiPersonalize = on) }
        }
        if (status.hasKey) {
            Toggle("Check the web first", "Discover looks the request up with Ollama web search before searching YouTube.", settings.aiUseWeb) { on ->
                Ai.prefs.update { it.copy(aiUseWeb = on) }
            }
        }
        Hint(
            "Sent to the server only when you use an AI feature: your request, titles and channels of search results, (with Personalize) titles from your library, " +
                "and the captions of videos you summarize or ask about.",
        )
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
