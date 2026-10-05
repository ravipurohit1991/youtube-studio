@file:OptIn(ExperimentalLayoutApi::class)

package com.ytdstudio.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Summarize
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SuggestionChip
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.ytdstudio.android.ai.AiCore
import com.ytdstudio.android.ai.ChatMessage
import com.ytdstudio.android.ai.InsightSource
import com.ytdstudio.android.ai.Insights
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * AI summary and questions about one video. Holds its own state so a sheet can be closed and
 * reopened without losing the summary; [stop] cancels whatever is being generated.
 */
class InsightController(val url: String, private val scope: CoroutineScope) {
    var summary by mutableStateOf<String?>(null)
    val messages = mutableStateListOf<ChatMessage>()
    var live by mutableStateOf("")
    var stage by mutableStateOf<String?>(null)
    var running by mutableStateOf<String?>(null)
    var source by mutableStateOf<InsightSource?>(null)
    var error by mutableStateOf<String?>(null)
    private var job: Job? = null

    private fun events() = Insights.Events(
        onStage = { s -> scope.launch(Dispatchers.Main) { stage = s } },
        onSource = { s -> scope.launch(Dispatchers.Main) { source = s } },
        onDelta = { d -> scope.launch(Dispatchers.Main) { live += d } },
    )

    fun summarize() {
        if (running != null) return
        start("summary") {
            summary = null
            val text = Insights.summarize(url, events())
            summary = text
        }
    }

    fun ask(question: String) {
        val q = question.trim()
        if (q.isEmpty() || running != null) return
        val history = buildList {
            summary?.let { add(ChatMessage("assistant", it)) }
            addAll(messages)
        }
        messages += ChatMessage("user", q)
        start("ask") {
            val answer = Insights.ask(url, q, history, events())
            messages += ChatMessage("assistant", answer.ifBlank { "(no answer)" })
        }
    }

    private fun start(kind: String, block: suspend () -> Unit) {
        running = kind
        live = ""
        stage = null
        error = null
        job = scope.launch(Dispatchers.Main) {
            try {
                block()
            } catch (e: CancellationException) {
                if (kind == "ask") messages += ChatMessage("assistant", "Stopped.")
                throw e
            } catch (e: Exception) {
                val message = e.message ?: "Something went wrong."
                if (kind == "ask") messages += ChatMessage("assistant", "Could not answer: $message") else error = message
            } finally {
                running = null
                live = ""
            }
        }
    }

    fun stop() {
        job?.cancel()
    }
}

private val QUICK_QUESTIONS = listOf("What are the main takeaways?", "Does it live up to its title?", "Explain it like I am new to this", "What should I skip?")

/** Summary with tappable key moments, quick questions, and a chat about the video. */
@Composable
fun InsightPanel(ctl: InsightController, onSeek: ((Double) -> Unit)?, autoSummarize: Boolean = false, modifier: Modifier = Modifier) {
    var question by androidx.compose.runtime.saveable.rememberSaveable(ctl.url) { mutableStateOf("") }
    LaunchedEffect(ctl) {
        if (autoSummarize && ctl.summary == null && ctl.running == null) ctl.summarize()
    }
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.AutoAwesome, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("AI insights", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            ctl.source?.let {
                Text(
                    if (it.language == null) "no captions" else (if (it.autoCaptions) "auto captions" else "captions") + " · " + it.language,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { ctl.summarize() }, enabled = ctl.running == null) {
                Icon(Icons.Rounded.Summarize, null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text(if (ctl.summary != null) "Summarize again" else "Summarize")
            }
            QUICK_QUESTIONS.forEach { q ->
                SuggestionChip(onClick = { ctl.ask(q) }, enabled = ctl.running == null, label = { Text(q) })
            }
        }
        if (ctl.running != null && ctl.live.isEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(10.dp))
                Text(ctl.stage ?: "Starting…", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                androidx.compose.material3.TextButton(onClick = { ctl.stop() }) { Text("Stop") }
            }
        }
        ctl.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        val summaryText = if (ctl.running == "summary") ctl.live else ctl.summary
        if (!summaryText.isNullOrEmpty()) {
            Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerHigh, modifier = Modifier.fillMaxWidth()) {
                RichText(summaryText, onSeek, Modifier.padding(14.dp))
            }
        }
        ctl.messages.forEach { m -> Bubble(m.content, m.role == "user", onSeek) }
        if (ctl.running == "ask" && ctl.live.isNotEmpty()) Bubble(ctl.live, false, onSeek)
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(
                value = question,
                onValueChange = { question = it },
                placeholder = { Text("Ask anything about this video…") },
                singleLine = true,
                modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = {
                    ctl.ask(question)
                    question = ""
                }),
            )
            Spacer(Modifier.width(8.dp))
            if (ctl.running != null) {
                FilledIconButton(onClick = { ctl.stop() }) { Icon(Icons.Rounded.Stop, "Stop") }
            } else {
                FilledIconButton(onClick = { ctl.ask(question); question = "" }, enabled = question.isNotBlank()) {
                    Icon(Icons.AutoMirrored.Rounded.Send, "Ask")
                }
            }
        }
    }
}

@Composable
private fun Bubble(text: String, mine: Boolean, onSeek: ((Double) -> Unit)?) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
        Surface(
            shape = MaterialTheme.shapes.large,
            color = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh,
            modifier = Modifier.widthIn(max = 520.dp),
        ) {
            if (mine) Text(text, Modifier.padding(horizontal = 12.dp, vertical = 9.dp), color = MaterialTheme.colorScheme.onPrimaryContainer)
            else RichText(text, onSeek, Modifier.padding(horizontal = 12.dp, vertical = 9.dp))
        }
    }
}

/**
 * The small Markdown subset the AI is asked to write: "## " headings, "- " bullets, **bold**, and
 * [mm:ss] timestamps, which become tappable links when [onSeek] is given.
 */
@Composable
fun RichText(text: String, onSeek: ((Double) -> Unit)?, modifier: Modifier = Modifier) {
    val accent = MaterialTheme.colorScheme.primary
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        text.lines().forEach { raw ->
            val line = raw.trimEnd()
            val heading = Regex("^#{1,4}\\s+(.*)$").find(line)
            val bullet = Regex("^\\s*(?:[-*•]|\\d+[.)])\\s+(.*)$").find(line)
            when {
                heading != null -> Text(
                    heading.groupValues[1].uppercase(),
                    style = MaterialTheme.typography.labelLarge,
                    color = accent,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(top = 6.dp),
                )
                bullet != null -> Row {
                    Text("•  ", style = MaterialTheme.typography.bodyMedium)
                    Text(inline(bullet.groupValues[1], onSeek, accent), style = MaterialTheme.typography.bodyMedium)
                }
                line.isNotBlank() -> Text(inline(line, onSeek, accent), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

private fun inline(text: String, onSeek: ((Double) -> Unit)?, accent: androidx.compose.ui.graphics.Color): AnnotatedString = buildAnnotatedString {
    val token = Regex("\\*\\*([^*\\n]+)\\*\\*|\\[(\\d{1,2}:\\d{2}(?::\\d{2})?)]")
    var at = 0
    token.findAll(text).forEach { m ->
        append(text.substring(at, m.range.first))
        val bold = m.groups[1]
        val stamp = m.groups[2]
        if (bold != null) {
            withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(bold.value) }
        } else if (stamp != null) {
            val style = SpanStyle(color = accent, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace)
            val seconds = AiCore.parseStamp(stamp.value)
            if (onSeek != null) {
                withLink(LinkAnnotation.Clickable("t:" + stamp.value, TextLinkStyles(style)) { onSeek(seconds) }) { append(stamp.value) }
            } else {
                withStyle(style) { append(stamp.value) }
            }
        }
        at = m.range.last + 1
    }
    append(text.substring(at))
}
