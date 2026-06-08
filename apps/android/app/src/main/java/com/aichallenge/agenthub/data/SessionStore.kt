package com.aichallenge.agenthub.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

private val Context.agentHubDataStore by preferencesDataStore(name = "agenthub_session")

data class SessionState(
    val baseUrl: String = DEFAULT_API_BASE_URL,
    val token: String? = null,
    val user: UserView? = null
) {
    val authenticated: Boolean get() = token != null && user != null
}

class SessionStore(
    context: Context,
    private val json: Json
) {
    private val dataStore = context.agentHubDataStore

    val session: Flow<SessionState> = dataStore.data.map { prefs ->
        val baseUrl = prefs[BASE_URL_KEY]?.ifBlank { DEFAULT_API_BASE_URL } ?: DEFAULT_API_BASE_URL
        val token = prefs[TOKEN_KEY]?.ifBlank { null }
        val user = prefs[USER_KEY]?.let { runCatching { json.decodeFromString(UserView.serializer(), it) }.getOrNull() }
        SessionState(baseUrl = baseUrl.trimEnd('/'), token = token, user = user)
    }

    suspend fun saveBaseUrl(baseUrl: String) {
        dataStore.edit { prefs ->
            prefs[BASE_URL_KEY] = baseUrl.trim().trimEnd('/').ifBlank { DEFAULT_API_BASE_URL }
        }
    }

    suspend fun saveSession(token: String, user: UserView) {
        dataStore.edit { prefs ->
            prefs[TOKEN_KEY] = token
            prefs[USER_KEY] = json.encodeToString(UserView.serializer(), user)
        }
    }

    suspend fun updateUser(user: UserView) {
        dataStore.edit { prefs ->
            prefs[USER_KEY] = json.encodeToString(UserView.serializer(), user)
        }
    }

    suspend fun clearSession() {
        dataStore.edit { prefs ->
            prefs.remove(TOKEN_KEY)
            prefs.remove(USER_KEY)
        }
    }

    private companion object {
        val BASE_URL_KEY = stringPreferencesKey("api_base_url")
        val TOKEN_KEY = stringPreferencesKey("token")
        val USER_KEY = stringPreferencesKey("user")
    }
}
