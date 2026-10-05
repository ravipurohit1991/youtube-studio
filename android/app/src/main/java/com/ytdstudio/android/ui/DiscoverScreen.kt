@file:OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.automirrored.rounded.Undo
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Block
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Headphones
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Summarize
import androidx.compose.material.icons.rounded.ThumbDown
import androidx.compose.material.icons.rounded.ThumbUp
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ytdstudio.android.ai.Ai
import com.ytdstudio.android.ai.DiscoverLength
import com.ytdstudio.android.ai.DiscoverRecency
import com.ytdstudio.android.ai.DiscoverVideo
import com.ytdstudio.android.data.DownloadMode

private val EXAMPLES = listOf(
    "Calm lo-fi to study to, no vocals, at least an hour",
    "Beginner-friendly Rust tutorials that build a real project",
    "In-depth documentaries about the deep ocean, not clickbait",
    "Quick healthy dinner recipes under 15 minutes",
)

private val REFINE_CHIPS = listOf("Shorter", "More in-depth", "More recent", "Less mainstream", "For beginners")

/** Your own YouTube algorithm: describe what you want, the model plans searches and ranks the results for you. */
@Composable
fun DiscoverScreen(vm: MainViewModel, ai: AiViewModel) {
    val context = LocalContext.current
    val settings by vm.prefs.settings.collectAsStateWithLifecycle()
    val taste by Ai.taste.state.collectAsStateWithLifecycle()
    var insight by remember { mutableStateOf<DiscoverVideo?>(null) }
    var refineText by remember { mutableStateOf("") }
    var showTaste by remember { mutableStateOf(false) }
    val status = ai.status

    if (!status.ready) {
        Column(Modifier.statusBarsPadding()) {
            EmptyState(
                Icons.Rounded.AutoAwesome,
                "Your own YouTube algorithm",
                "Describe what you want in plain words and an AI model plans the searches, then ranks every result for you, with a reason for each pick. " +
                    "It also summarizes videos and sorts your library into playlists. Connect Ollama Cloud (or your own Ollama server) to start.",
            ) {
                Button(onClick = { vm.tab = Tab.SETTINGS }) {
                    Icon(Icons.Rounded.Settings, null)
                    Spacer(Modifier.width(6.dp))
                    Text("Set up AI")
                }
            }
        }
        return
    }

    val play = { v: DiscoverVideo, startSeconds: Double ->
        vm.watch(v.url, v.title, v.thumbnail, false) { source, thumb ->
            context.startActivity(PlayerActivity.stream(context, source, thumb, (startSeconds * 1000).toLong()))
        }
    }

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item {
            val scheme = MaterialTheme.colorScheme
            Box(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(scheme.primary.copy(alpha = 0.18f), Violet.copy(alpha = 0.08f), Color.Transparent)))) {
                Column(Modifier.statusBarsPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Discover", style = MaterialTheme.typography.headlineMedium, modifier = Modifier.weight(1f))
                        Text(status.model, style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
                    }
                    OutlinedTextField(
                        value = ai.prompt,
                        onValueChange = { ai.prompt = it },
                        placeholder = { Text("What do you want to watch? e.g. honest reviews of budget keyboards, no unboxings") },
                        modifier = Modifier.fillMaxWidth(),
                        minLines = 2,
                        maxLines = 4,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { ai.find() }),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Button(onClick = { ai.find() }, enabled = !ai.discovering, modifier = Modifier.weight(1f)) {
                            Icon(Icons.Rounded.Search, null)
                            Spacer(Modifier.width(6.dp))
                            Text("Find videos")
                        }
                        FilledTonalButton(onClick = { ai.forYou() }, enabled = !ai.discovering) {
                            Icon(Icons.Rounded.AutoAwesome, null)
                            Spacer(Modifier.width(6.dp))
                            Text("For you")
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DiscoverLength.entries.forEach { l ->
                            FilterChip(ai.length == l, { ai.length = l }, { Text(l.label) })
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DiscoverRecency.entries.forEach { r ->
                            FilterChip(ai.recency == r, { ai.recency = r }, { Text(r.label) })
                        }
                    }
                    OutlinedTextField(
                        value = ai.avoid,
                        onValueChange = { ai.avoid = it },
                        placeholder = { Text("Always avoid… (reaction videos, shorts, AI voiceovers)") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    SwitchRow("Personalize", "Use your downloads, favorites and thumbs up/down.", settings.aiPersonalize) { on ->
                        vm.prefs.update { it.copy(aiPersonalize = on) }
                    }
                    if (status.hasKey) {
                        SwitchRow("Check the web first", "Ollama web search: good for new releases and current events.", settings.aiUseWeb) { on ->
                            vm.prefs.update { it.copy(aiUseWeb = on) }
                        }
                    }
                }
            }
        }

        if (ai.session == null && !ai.discovering) {
            item {
                Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Try", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    (taste.recent.take(4).ifEmpty { EXAMPLES }).forEach { example ->
                        AssistChip(onClick = { ai.find(example) }, label = { Text(example, maxLines = 1, overflow = TextOverflow.Ellipsis) })
                    }
                }
            }
            item { HowItWorks() }
        }

        if (ai.discovering) {
            item {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.secondaryContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                        Text(ai.stage ?: "Working…", modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSecondaryContainer)
                        TextButton(onClick = { ai.stopDiscover() }) { Text("Stop") }
                    }
                }
            }
        }

        val result = ai.result
        val session = ai.session
        if (result != null && session != null) {
            item {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surfaceContainer, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Icon(Icons.Rounded.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp).padding(top = 2.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(result.intent, style = MaterialTheme.typography.titleSmall)
                        }
                        if (session.refinements.isNotEmpty()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("Refined: " + session.refinements.joinToString(" · "), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                IconButton(onClick = { ai.undoRefine() }, enabled = !ai.discovering) { Icon(Icons.AutoMirrored.Rounded.Undo, "Undo the last refinement") }
                            }
                        }
                        Text(
                            "Searched: " + result.queries.joinToString(" · ") { it.q + if (it.sort.name != "RELEVANCE") " (" + it.sort.name.lowercase() + ")" else "" },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        if (result.webSources.isNotEmpty()) {
                            Text(
                                "Web: " + result.webSources.take(4).joinToString(" · ") { it.first },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        Text(
                            (if (result.unranked) "In search order" else "Ranked ${ai.videos.size} of ${result.candidates} candidates") +
                                " by ${result.model} in " + "%.1f".format(result.elapsedMs / 1000.0) + "s. Videos you already have and hidden channels are left out.",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        HorizontalDivider()
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = refineText,
                                onValueChange = { refineText = it },
                                placeholder = { Text("Refine: shorter, more advanced…") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                keyboardActions = KeyboardActions(onDone = { ai.refine(refineText); refineText = "" }),
                            )
                            Spacer(Modifier.width(8.dp))
                            FilledTonalButton(onClick = { ai.more() }, enabled = !ai.discovering) {
                                Icon(Icons.Rounded.Add, null)
                                Text("More")
                            }
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            REFINE_CHIPS.forEach { chip ->
                                AssistChip(onClick = { ai.refine(chip.lowercase()) }, enabled = !ai.discovering, label = { Text(chip) })
                            }
                        }
                        TextButton(onClick = { showTaste = !showTaste }) {
                            Text("Your taste: ${taste.liked.size} up · ${taste.disliked.size} down · ${taste.blockedChannels.size} hidden")
                        }
                        if (showTaste) TasteEditor()
                    }
                }
            }
            items(ai.videos, key = { it.id }) { v ->
                DiscoverCard(
                    v,
                    liked = taste.liked.any { it.id == v.id },
                    disliked = taste.disliked.any { it.id == v.id },
                    busy = vm.resolvingStream == v.url,
                    onPlay = { play(v, 0.0) },
                    onSummary = { insight = v },
                    onLike = { ai.like(v) },
                    onDislike = { ai.dislike(v) },
                    onDownload = { mode -> vm.queueDiscover(listOf(v), mode) },
                    onHide = { v.channel?.let { ai.hideChannel(it) } },
                    onOpen = { openOnYouTube(context, v.url) },
                )
            }
            if (ai.videos.size > 1) {
                item {
                    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        FilledTonalButton(onClick = { vm.queueDiscover(ai.videos, DownloadMode.VIDEO) }) {
                            Icon(Icons.Rounded.Download, null)
                            Spacer(Modifier.width(6.dp))
                            Text("Download all")
                        }
                        FilledTonalButton(onClick = { vm.queueDiscover(ai.videos, DownloadMode.AUDIO) }) {
                            Icon(Icons.Rounded.Headphones, null)
                            Spacer(Modifier.width(6.dp))
                            Text("All as audio")
                        }
                    }
                }
            }
        }
    }

    insight?.let { v ->
        val scope = rememberCoroutineScope()
        val ctl = remember(v.url) { InsightController(v.url, scope) }
        DisposableEffect(ctl) { onDispose { ctl.stop() } }
        ModalBottomSheet(onDismissRequest = { insight = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            LazyColumn(contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 32.dp)) {
                item {
                    Text(v.title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(v.channel, v.duration?.let { formatDuration(it) }).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(12.dp))
                    InsightPanel(ctl, onSeek = { seconds -> insight = null; play(v, seconds) }, autoSummarize = true)
                }
            }
        }
    }
}

@Composable
private fun DiscoverCard(
    v: DiscoverVideo,
    liked: Boolean,
    disliked: Boolean,
    busy: Boolean,
    onPlay: () -> Unit,
    onSummary: () -> Unit,
    onLike: () -> Unit,
    onDislike: () -> Unit,
    onDownload: (DownloadMode) -> Unit,
    onHide: () -> Unit,
    onOpen: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(MaterialTheme.shapes.large).clickable(onClick = onPlay)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(MaterialTheme.shapes.large)) {
            Thumb(v.thumbnail, Modifier.matchParentSize())
            v.score?.let { score ->
                Text(
                    "$score% match",
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White,
                    modifier = Modifier.align(Alignment.BottomStart).padding(8.dp)
                        .background(if (score >= 80) Brush.linearGradient(listOf(Accent, Violet)) else Brush.linearGradient(listOf(Color(0xC0000000), Color(0xC0000000))), RoundedCornerShape(6.dp))
                        .padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
            v.duration?.let {
                Text(
                    formatDuration(it),
                    style = MaterialTheme.typography.labelMedium,
                    color = Color.White,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(8.dp).background(Color(0xC0000000), RoundedCornerShape(6.dp)).padding(horizontal = 7.dp, vertical = 2.dp),
                )
            }
            if (busy) {
                Box(Modifier.matchParentSize().background(Color(0x66000000)), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = Color.White)
                }
            }
        }
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(v.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(v.channel, v.views?.let { formatCount(it) + " views" }).joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                v.reason?.let {
                    Row(Modifier.padding(top = 4.dp)) {
                        Icon(Icons.Rounded.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(14.dp).padding(top = 2.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(it, style = MaterialTheme.typography.bodySmall, fontStyle = FontStyle.Italic, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Download video") }, leadingIcon = { Icon(Icons.Rounded.Download, null) }, onClick = { menu = false; onDownload(DownloadMode.VIDEO) })
                    DropdownMenuItem(text = { Text("Download audio only") }, leadingIcon = { Icon(Icons.Rounded.Headphones, null) }, onClick = { menu = false; onDownload(DownloadMode.AUDIO) })
                    DropdownMenuItem(text = { Text("Open on YouTube") }, leadingIcon = { Icon(Icons.AutoMirrored.Rounded.OpenInNew, null) }, onClick = { menu = false; onOpen() })
                    if (v.channel != null) {
                        DropdownMenuItem(text = { Text("Never show " + v.channel.take(28)) }, leadingIcon = { Icon(Icons.Rounded.Block, null) }, onClick = { menu = false; onHide() })
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onPlay) {
                Icon(Icons.Rounded.PlayArrow, null)
                Text("Play")
            }
            TextButton(onClick = onSummary) {
                Icon(Icons.Rounded.Summarize, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Summary")
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = onLike) {
                Icon(if (liked) Icons.Rounded.ThumbUp else Icons.Outlined.ThumbUp, "More like this", tint = if (liked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onDislike) {
                Icon(if (disliked) Icons.Rounded.ThumbDown else Icons.Outlined.ThumbDown, "Less like this", tint = if (disliked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun TasteEditor() {
    val taste by Ai.taste.state.collectAsStateWithLifecycle()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Tap an item to forget it. Discover ranks with this when Personalize is on.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (taste.liked.isNotEmpty()) Text("More like", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            taste.liked.take(20).forEach { t -> AssistChip(onClick = { Ai.taste.clear(t.id) }, label = { Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }) }
        }
        if (taste.disliked.isNotEmpty()) Text("Less like", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            taste.disliked.take(20).forEach { t -> AssistChip(onClick = { Ai.taste.clear(t.id) }, label = { Text(t.title, maxLines = 1, overflow = TextOverflow.Ellipsis) }) }
        }
        if (taste.blockedChannels.isNotEmpty()) Text("Hidden channels", style = MaterialTheme.typography.labelLarge)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            taste.blockedChannels.forEach { c -> AssistChip(onClick = { Ai.taste.unblock(c) }, label = { Text("$c ×") }) }
        }
        TextButton(onClick = { Ai.taste.reset() }) { Text("Reset taste", color = MaterialTheme.colorScheme.error) }
    }
}

@Composable
private fun HowItWorks() {
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("How it works", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
        listOf(
            "Say it like you would to a friend." to "Mood, level, length, what to avoid. For you works from your library alone.",
            "The model plans the searches" to "with YouTube's own date, length and sort filters, and the app runs them.",
            "Every result is ranked for you" to "with a reason. Thumbs up/down and hidden channels teach it your taste.",
        ).forEachIndexed { i, (title, text) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(28.dp).clip(CircleShape).background(Brush.linearGradient(listOf(Accent, Violet))), contentAlignment = Alignment.Center) {
                    Text("${i + 1}", color = Color.White, style = MaterialTheme.typography.labelLarge)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(title, style = MaterialTheme.typography.labelLarge)
                    Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).padding(end = 12.dp)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

private fun openOnYouTube(context: Context, url: String) {
    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
}
