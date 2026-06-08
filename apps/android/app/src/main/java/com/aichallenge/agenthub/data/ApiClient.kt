package com.aichallenge.agenthub.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.Closeable

class ApiException(val code: Int, override val message: String) : RuntimeException(message)

class StreamHandle(private val eventSource: EventSource) : Closeable {
    override fun close() {
        eventSource.cancel()
    }
}

@OptIn(ExperimentalSerializationApi::class)
class ApiClient(
    private val sessionStore: SessionStore,
    val json: Json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = false
        coerceInputValues = true
    },
    private val httpClient: OkHttpClient = OkHttpClient.Builder().build()
) {
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    suspend fun <T> get(path: String, serializer: KSerializer<T>): T =
        request("GET", path, null, null, serializer)

    suspend fun <T, B> post(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>
    ): T = request("POST", path, json.encodeToString(bodySerializer, body), jsonMediaType.toString(), serializer)

    suspend fun <T> postEmpty(path: String, serializer: KSerializer<T>): T =
        request("POST", path, "{}", jsonMediaType.toString(), serializer)

    suspend fun <T, B> patch(
        path: String,
        body: B,
        bodySerializer: KSerializer<B>,
        serializer: KSerializer<T>
    ): T = request("PATCH", path, json.encodeToString(bodySerializer, body), jsonMediaType.toString(), serializer)

    suspend fun <T> delete(path: String, serializer: KSerializer<T>): T =
        request("DELETE", path, null, null, serializer)

    private suspend fun <T> request(
        method: String,
        path: String,
        bodyJson: String?,
        contentType: String?,
        serializer: KSerializer<T>
    ): T = withContext(Dispatchers.IO) {
        val session = sessionStore.session.first()
        val requestBuilder = Request.Builder()
            .url("${session.baseUrl}${path}")
            .method(
                method,
                if (bodyJson == null) null else bodyJson.toRequestBody((contentType ?: "application/json").toMediaType())
            )
            .header("Content-Type", "application/json")
        session.token?.let { requestBuilder.header("Authorization", "Bearer $it") }

        httpClient.newCall(requestBuilder.build()).execute().use { response ->
            if (response.code == 401) {
                sessionStore.clearSession()
                throw ApiException(UNAUTHORIZED_CODE, "登录已过期，请重新登录")
            }

            val text = response.body?.string().orEmpty()
            if (text.isBlank()) {
                throw ApiException(response.code, "请求失败（HTTP ${response.code}）")
            }

            val envelope = runCatching {
                json.decodeFromString(ApiResponse.serializer(serializer), text)
            }.getOrElse {
                throw ApiException(response.code, "响应解析失败（HTTP ${response.code}）")
            }

            if (envelope.code == SUCCESS_CODE) {
                envelope.data ?: throw ApiException(envelope.code, "响应数据为空")
            } else {
                if (envelope.code == UNAUTHORIZED_CODE) sessionStore.clearSession()
                throw ApiException(envelope.code, envelope.message.ifBlank { "请求失败（code ${envelope.code}）" })
            }
        }
    }

    suspend fun stream(
        path: String,
        onEvent: (JsonElement) -> Unit,
        onError: (String) -> Unit,
        onDone: () -> Unit
    ): StreamHandle {
        val session = sessionStore.session.first()
        val requestBuilder = Request.Builder()
            .url("${session.baseUrl}${path}")
            .header("Accept", "text/event-stream")
        session.token?.let { requestBuilder.header("Authorization", "Bearer $it") }

        val listener = object : EventSourceListener() {
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                if (data == "[DONE]") return
                val element = runCatching { json.parseToJsonElement(data) }.getOrNull()
                if (element != null) onEvent(element) else onError(data)
            }

            override fun onClosed(eventSource: EventSource) {
                onDone()
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: okhttp3.Response?) {
                if (response?.code == 401) {
                    runBlocking { sessionStore.clearSession() }
                }
                val message = t?.message ?: response?.message ?: "事件流连接失败"
                onError(message)
                onDone()
            }
        }

        return StreamHandle(EventSources.createFactory(httpClient).newEventSource(requestBuilder.build(), listener))
    }

    fun <T> listSerializer(serializer: KSerializer<T>): KSerializer<List<T>> = ListSerializer(serializer)
}
