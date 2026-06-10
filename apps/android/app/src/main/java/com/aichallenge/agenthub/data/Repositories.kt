package com.aichallenge.agenthub.data

import kotlinx.serialization.builtins.ListSerializer

class AuthRepository(private val api: ApiClient, private val sessionStore: SessionStore) {
    suspend fun login(account: String, password: String): UserView {
        val result = api.post(
            "/user/login",
            LoginPayload(account, password),
            LoginPayload.serializer(),
            LoginResult.serializer()
        )
        sessionStore.saveSession(result.token, result.user)
        return result.user
    }

    suspend fun register(account: String, password: String): UserView {
        api.post("/user/register", RegisterPayload(account, password), RegisterPayload.serializer(), UserView.serializer())
        return login(account, password)
    }

    suspend fun me(): UserView = api.get("/user/me", UserView.serializer()).also { sessionStore.updateUser(it) }

    suspend fun logout() {
        runCatching { api.postEmpty("/user/logout", DeletedResult.serializer()) }
        sessionStore.clearSession()
    }
}

class ProviderRepository(private val api: ApiClient) {
    suspend fun list(): List<PlatformProviderView> =
        api.get("/platform-providers", ListSerializer(PlatformProviderView.serializer()))
}

class AgentRepository(private val api: ApiClient) {
    suspend fun list(): List<AgentView> = api.get("/agents", ListSerializer(AgentView.serializer()))

    suspend fun create(payload: CreateAgentPayload): AgentView =
        api.post("/agents", payload, CreateAgentPayload.serializer(), AgentView.serializer())

    suspend fun delete(id: String): DeletedResult = api.delete("/agents/$id", DeletedResult.serializer())
}

class AgentChatRepository(private val api: ApiClient) {
    suspend fun list(): List<AgentChatView> =
        api.get("/agent-chats", ListSerializer(AgentChatView.serializer()))

    suspend fun create(payload: CreateAgentChatPayload): AgentChatView =
        api.post("/agent-chats", payload, CreateAgentChatPayload.serializer(), AgentChatView.serializer())

    suspend fun update(id: String, payload: UpdateChatPayload): AgentChatView =
        api.patch("/agent-chats/$id", payload, UpdateChatPayload.serializer(), AgentChatView.serializer())

    suspend fun delete(id: String): DeletedResult = api.delete("/agent-chats/$id", DeletedResult.serializer())

    suspend fun messages(id: String): List<AgentChatMessageView> =
        api.get("/agent-chats/$id/messages", ListSerializer(AgentChatMessageView.serializer()))

    suspend fun converse(id: String, prompt: String, replyTo: MessageReplyRef? = null): StartTurnResult =
        api.post("/agent-chats/$id/converse", ConversePayload(prompt, replyTo), ConversePayload.serializer(), StartTurnResult.serializer())

    suspend fun abortTurn(id: String, turnId: String): DeletedResult =
        api.postEmpty("/agent-chats/$id/turns/$turnId/abort", DeletedResult.serializer())

    suspend fun subscribeTurn(
        id: String,
        turnId: String,
        onEvent: (kotlinx.serialization.json.JsonElement) -> Unit,
        onError: (String) -> Unit,
        onDone: () -> Unit
    ): StreamHandle = api.stream("/agent-chats/$id/turns/$turnId/events", onEvent, onError, onDone)
}

class GroupChatRepository(private val api: ApiClient) {
    suspend fun list(): List<GroupChatView> =
        api.get("/group-chats", ListSerializer(GroupChatView.serializer()))

    suspend fun create(payload: CreateGroupChatPayload): GroupChatView =
        api.post("/group-chats", payload, CreateGroupChatPayload.serializer(), GroupChatView.serializer())

    suspend fun update(id: String, payload: UpdateChatPayload): GroupChatView =
        api.patch("/group-chats/$id", payload, UpdateChatPayload.serializer(), GroupChatView.serializer())

    suspend fun delete(id: String): DeletedResult = api.delete("/group-chats/$id", DeletedResult.serializer())

    suspend fun messages(id: String): List<GroupMessageView> =
        api.get("/group-chats/$id/messages", ListSerializer(GroupMessageView.serializer()))

    suspend fun converse(id: String, text: String, mentions: List<String>? = null, replyTo: MessageReplyRef? = null): StartGroupRunResult =
        api.post("/group-chats/$id/converse", ConverseGroupPayload(text, mentions, replyTo), ConverseGroupPayload.serializer(), StartGroupRunResult.serializer())

    suspend fun abortRun(id: String, runId: String): DeletedResult =
        api.postEmpty("/group-chats/$id/runs/$runId/abort", DeletedResult.serializer())

    suspend fun subscribeRun(
        id: String,
        runId: String,
        onEvent: (kotlinx.serialization.json.JsonElement) -> Unit,
        onError: (String) -> Unit,
        onDone: () -> Unit
    ): StreamHandle = api.stream("/group-chats/$id/runs/$runId/events", onEvent, onError, onDone)

    suspend fun blackboard(id: String): BlackboardView =
        api.get("/group-chats/$id/blackboard", BlackboardView.serializer())

    suspend fun artifactPreview(id: String, artifactId: String): BlackboardArtifactPreview =
        api.get(
            "/group-chats/$id/blackboard/artifacts/$artifactId/preview",
            BlackboardArtifactPreview.serializer()
        )
}

class WorkspaceFsRepository(private val api: ApiClient) {
    suspend fun roots(): List<ServerDirectoryRoot> =
        api.get("/workspace-fs/roots", ListSerializer(ServerDirectoryRoot.serializer()))

    suspend fun directories(path: String? = null): ServerDirectoryListing {
        val query = path?.takeIf { it.isNotBlank() }?.let { "?path=${java.net.URLEncoder.encode(it, "UTF-8")}" } ?: ""
        return api.get("/workspace-fs/directories$query", ServerDirectoryListing.serializer())
    }
}
