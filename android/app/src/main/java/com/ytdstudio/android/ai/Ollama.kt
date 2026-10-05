package com.ytdstudio.android.ai

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class ChatMessage(val role: String, val content: String)

data class WebResult(val title: String, val url: String, val content: String)

/**
 * Ollama client. Ollama Cloud (https://ollama.com) and a local Ollama speak the same API; the cloud
 * one needs "Authorization: Bearer <key>". Chats are always streamed (NDJSON), so long generations
 * stay alive and thinking models show progress. Cancelling the coroutine closes the connection.
 */
object Ollama {
    private const val TAG = "Ollama"
    private const val WEB_SEARCH_URL = "https://ollama.com/api/web_search"
    /** Give up when the server sends nothing for this long (big cloud models can think for a while). */
    private const val IDLE_TIMEOUT_MS = 150_000

    class Options(
        /** "json" or a JSON schema: structured output. */
        val format: Any? = null,
        val temperature: Double? = null,
        /** Ask a local server for a bigger context window (transcripts). Cloud models have large windows already. */
        val longContext: Boolean = false,
        val onDelta: ((String) -> Unit)? = null,
        val onThinking: (() -> Unit)? = null,
    )

    private class HttpError(val code: Int, message: String) : IOException(message)

    fun requireReady(): String {
        val status = Ai.status()
        if (status.isCloud && !status.hasKey) throw IllegalStateException("Add your Ollama API key in Settings > AI first.")
        if (status.model.isBlank()) throw IllegalStateException("Pick a model in Settings > AI first.")
        return status.model
    }

    /** One chat call. Returns the full answer; [Options.onDelta] sees it arrive piece by piece. */
    suspend fun chat(messages: List<ChatMessage>, options: Options = Options()): String {
        val model = requireReady()
        val host = Ai.host()
        val body = JSONObject()
            .put("model", model)
            .put("stream", true)
            .put("messages", JSONArray().apply { messages.forEach { put(JSONObject().put("role", it.role).put("content", it.content)) } })
        options.format?.let { body.put("format", it) }
        val extra = JSONObject()
        options.temperature?.let { extra.put("temperature", it) }
        if (options.longContext && !AiCore.isCloudHost(host)) extra.put("num_ctx", 32768)
        if (extra.length() > 0) body.put("options", extra)
        return try {
            request("$host/api/chat", body.toString(), IDLE_TIMEOUT_MS) { conn, wanted ->
                val content = StringBuilder()
                var sawThinking = false
                conn.inputStream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                    for (line in lines) {
                        if (!wanted()) break
                        if (line.isBlank()) continue
                        val chunk = try {
                            JSONObject(line)
                        } catch (e: Exception) {
                            continue
                        }
                        if (chunk.has("error")) throw IllegalStateException("Ollama: " + chunk.optString("error"))
                        val message = chunk.optJSONObject("message") ?: continue
                        if (!sawThinking && message.optString("thinking", "").isNotEmpty()) {
                            sawThinking = true
                            options.onThinking?.invoke()
                        }
                        val piece = message.optString("content", "")
                        if (piece.isNotEmpty()) {
                            content.append(piece)
                            options.onDelta?.invoke(piece)
                        }
                    }
                }
                content.toString().trim()
            }
        } catch (e: HttpError) {
            // Some models or servers reject structured output; ask again in plain JSON mode.
            if (e.code == 400 && options.format is JSONObject && Regex("format|schema|grammar", RegexOption.IGNORE_CASE).containsMatchIn(e.message ?: "")) {
                Log.i(TAG, "schema format rejected, retrying with format=json")
                chat(messages, Options("json", options.temperature, options.longContext, options.onDelta, options.onThinking))
            } else {
                throw IllegalStateException(e.message)
            }
        }
    }

    /** Structured output: a JSON schema in `format`, and one retry if the reply still is not valid JSON. */
    suspend fun chatJson(messages: List<ChatMessage>, schema: JSONObject, temperature: Double? = null, longContext: Boolean = false, onThinking: (() -> Unit)? = null): JSONObject {
        val first = chat(messages, Options(schema, temperature, longContext, onThinking = onThinking))
        return try {
            AiCore.parseJsonReply(first)
        } catch (e: IllegalStateException) {
            Log.i(TAG, "invalid JSON reply, asking again")
            val second = chat(
                messages + ChatMessage("assistant", first.take(4000)) +
                    ChatMessage("user", "That was not valid JSON. Reply again with only the JSON object that matches the schema, nothing else."),
                Options(schema, temperature, longContext),
            )
            AiCore.parseJsonReply(second)
        }
    }

    suspend fun listModels(): List<AiModel> = try {
        request(Ai.host() + "/api/tags", null, 20_000) { conn, _ ->
            val data = JSONObject(conn.inputStream.bufferedReader().readText())
            val models = data.optJSONArray("models") ?: JSONArray()
            (0 until models.length()).mapNotNull { i ->
                val m = models.optJSONObject(i) ?: return@mapNotNull null
                val name = m.optString("name", "").ifEmpty { m.optString("model", "") }
                if (name.isEmpty()) null else AiModel(
                    name = name,
                    size = m.optLong("size", 0).takeIf { it > 0 },
                    parameterSize = m.optJSONObject("details")?.optString("parameter_size", "")?.takeIf { it.isNotEmpty() },
                )
            }.sortedBy { it.name }
        }
    } catch (e: HttpError) {
        throw IllegalStateException(e.message)
    }

    /** Ollama's hosted web search (always on ollama.com, needs a key even when chatting with a local server). */
    suspend fun webSearch(query: String, maxResults: Int): List<WebResult> {
        val key = Ai.vault.get() ?: throw IllegalStateException("Web search needs an Ollama API key.")
        val body = JSONObject().put("query", query).put("max_results", maxResults.coerceIn(1, 10)).toString()
        return try {
            request(WEB_SEARCH_URL, body, 30_000, keyOverride = key) { conn, _ ->
                val results = JSONObject(conn.inputStream.bufferedReader().readText()).optJSONArray("results") ?: JSONArray()
                (0 until results.length()).mapNotNull { i ->
                    results.optJSONObject(i)?.let { WebResult(it.optString("title", ""), it.optString("url", ""), it.optString("content", "").take(600)) }
                }
            }
        } catch (e: HttpError) {
            throw IllegalStateException(e.message)
        }
    }

    /** Runs the blocking HTTP work; a cancelled caller does not wait for it (see [request]). */
    private val io = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * One HTTP call. The blocking work runs detached on [io] and the caller only awaits it, so
     * cancelling the caller returns right away even while a read is stuck waiting on the server;
     * the connection is then closed off-thread and [handle] sees `wanted()` turn false.
     */
    private suspend fun <T> request(
        url: String,
        body: String?,
        readTimeoutMs: Int,
        keyOverride: String? = null,
        handle: (conn: HttpURLConnection, wanted: () -> Boolean) -> T,
    ): T {
        val key = keyOverride ?: Ai.vault.get()?.takeIf { AiCore.keyAllowedFor(Ai.host()) }
        val wanted = AtomicBoolean(true)
        val connection = AtomicReference<HttpURLConnection?>(null)
        val work = io.async {
            val conn = URI(url).toURL().openConnection() as HttpURLConnection
            connection.set(conn)
            try {
                conn.connectTimeout = 20_000
                conn.readTimeout = readTimeoutMs
                conn.setRequestProperty("User-Agent", "YTD-Studio-Android")
                conn.setRequestProperty("Accept", "application/json")
                if (key != null) conn.setRequestProperty("Authorization", "Bearer $key")
                if (body != null) {
                    conn.requestMethod = "POST"
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val code = conn.responseCode
                if (code !in 200..299) throw httpError(code, conn.errorStream?.bufferedReader()?.use { it.readText() } ?: "", url)
                handle(conn) { wanted.get() }
            } catch (e: HttpError) {
                throw e
            } catch (e: IOException) {
                throw IllegalStateException(
                    when (e) {
                        is SocketTimeoutException -> "The model stopped responding. Try again or pick a faster model."
                        else -> "Could not reach " + Ai.host() + " (" + (e.message ?: e.javaClass.simpleName) + "). Check your connection and the server in Settings > AI."
                    },
                )
            } finally {
                if (!wanted.get()) conn.disconnect()
            }
        }
        try {
            return work.await()
        } catch (e: CancellationException) {
            wanted.set(false)
            io.launch { connection.get()?.disconnect() }
            throw e
        }
    }

    private fun httpError(code: Int, raw: String, url: String): HttpError {
        val detail = try {
            JSONObject(raw).optString("error", raw)
        } catch (e: Exception) {
            raw
        }.replace(Regex("\\s+"), " ").trim().take(300)
        val host = Ai.host()
        val suffix = if (detail.isNotEmpty()) " ($detail)" else ""
        val message = when {
            code == 401 || code == 403 ->
                (if (AiCore.isCloudHost(host)) "Ollama Cloud" else host) + " rejected the request ($code). " +
                    (if (Ai.vault.get() != null) "Check the API key in Settings > AI." else "Add your Ollama API key in Settings > AI.") + suffix
            code == 429 -> "Ollama usage limit reached for now (429). Try again later or pick a smaller model.$suffix"
            code == 404 && detail.contains("model", ignoreCase = true) -> "Model \"" + Ai.status().model + "\" is not available on $host. Pick another one in Settings > AI."
            else -> (if (url.endsWith("/api/tags")) "Listing models" else if (url.contains("web_search")) "Web search" else "Chat") + " failed ($code)" + (if (detail.isNotEmpty()) ": $detail" else "")
        }
        return HttpError(code, message)
    }
}
