package com.aichallenge.agenthub.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.aichallenge.agenthub.data.AgentChatRepository
import com.aichallenge.agenthub.data.AgentChatView
import com.aichallenge.agenthub.data.AgentRepository
import com.aichallenge.agenthub.data.AgentRunDisplayMessage
import com.aichallenge.agenthub.data.ApiClient
import com.aichallenge.agenthub.data.ApiException
import com.aichallenge.agenthub.data.AuthRepository
import com.aichallenge.agenthub.data.BlackboardArtifact
import com.aichallenge.agenthub.data.BlackboardArtifactPreview
import com.aichallenge.agenthub.data.BlackboardView
import com.aichallenge.agenthub.data.ChatListItem
import com.aichallenge.agenthub.data.CreateAgentChatPayload
import com.aichallenge.agenthub.data.CreateAgentPayload
import com.aichallenge.agenthub.data.CreateGroupChatPayload
import com.aichallenge.agenthub.data.DisplayMessage
import com.aichallenge.agenthub.data.GroupChatRepository
import com.aichallenge.agenthub.data.GroupChatView
import com.aichallenge.agenthub.data.PlatformProviderView
import com.aichallenge.agenthub.data.ProviderRepository
import com.aichallenge.agenthub.data.RuntimeState
import com.aichallenge.agenthub.data.SenderInfo
import com.aichallenge.agenthub.data.ServerDirectoryListing
import com.aichallenge.agenthub.data.ServerDirectoryRoot
import com.aichallenge.agenthub.data.SessionState
import com.aichallenge.agenthub.data.SessionStore
import com.aichallenge.agenthub.data.StreamHandle
import com.aichallenge.agenthub.data.SystemDisplayMessage
import com.aichallenge.agenthub.data.TextDisplayMessage
import com.aichallenge.agenthub.data.UpdateChatPayload
import com.aichallenge.agenthub.data.WorkspaceFsRepository
import com.aichallenge.agenthub.data.agentInitials
import com.aichallenge.agenthub.data.agentMessageToDisplay
import com.aichallenge.agenthub.data.buildInitialRunMessage
import com.aichallenge.agenthub.data.deriveChatItems
import com.aichallenge.agenthub.data.groupMessageToDisplay
import com.aichallenge.agenthub.data.groupRuntimeLabel
import com.aichallenge.agenthub.data.reduceAgentRun
import com.aichallenge.agenthub.data.reduceRuntime
import com.aichallenge.agenthub.data.sessionKey
import com.aichallenge.agenthub.data.sessionKind
import com.aichallenge.agenthub.data.sessionRawId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient

enum class MainTab { Chats, Groups, Agents }

enum class AuthMode { Login, Register }

enum class DirectoryMode { Single, Multiple }

enum class DirectoryTarget {
    AgentWorking,
    AgentSkills,
    ChatWorking,
    ChatSkills,
    GroupWorkspace
}

data class DirectoryPickerState(
    val open: Boolean = false,
    val title: String = "选择服务器目录",
    val mode: DirectoryMode = DirectoryMode.Single,
    val target: DirectoryTarget = DirectoryTarget.AgentWorking,
    val preferredKind: String? = null,
    val roots: List<ServerDirectoryRoot> = emptyList(),
    val listing: ServerDirectoryListing? = null,
    val pathDraft: String = "",
    val selectedPaths: List<String> = emptyList(),
    val newFolderOpen: Boolean = false,
    val newFolderName: String = "",
    val newFolderError: String? = null,
    val loading: Boolean = false,
    val error: String? = null
)

data class AppUiState(
    val ready: Boolean = false,
    val session: SessionState = SessionState(),
    val loading: Boolean = false,
    val message: String? = null,
    val authMode: AuthMode = AuthMode.Login,
    val mainTab: MainTab = MainTab.Chats,
    val providers: List<PlatformProviderView> = emptyList(),
    val agents: List<com.aichallenge.agenthub.data.AgentView> = emptyList(),
    val agentChats: List<AgentChatView> = emptyList(),
    val groupChats: List<GroupChatView> = emptyList(),
    val chatSearch: String = "",
    val activeKey: String? = null,
    val messages: List<DisplayMessage> = emptyList(),
    val messagesLoading: Boolean = false,
    val runtime: RuntimeState = RuntimeState(),
    val runningKeys: Set<String> = emptySet(),
    val blackboard: BlackboardView? = null,
    val artifactPreview: ArtifactPreviewState = ArtifactPreviewState(),
    val directoryPicker: DirectoryPickerState = DirectoryPickerState(),
    val pickedPaths: Map<DirectoryTarget, List<String>> = emptyMap()
)

/** Drives the read-only artifact preview sheet for the active group chat. */
data class ArtifactPreviewState(
    val artifact: BlackboardArtifact? = null,
    val loading: Boolean = false,
    val preview: BlackboardArtifactPreview? = null,
    val error: String? = null
) {
    val open: Boolean get() = artifact != null
}

data class RunningStream(val id: String, val handle: StreamHandle)

class AppViewModel(
    private val sessionStore: SessionStore,
    private val authRepository: AuthRepository,
    private val providerRepository: ProviderRepository,
    private val agentRepository: AgentRepository,
    private val agentChatRepository: AgentChatRepository,
    private val groupChatRepository: GroupChatRepository,
    private val workspaceFsRepository: WorkspaceFsRepository
) : ViewModel() {
    private val mutableState = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = mutableState
        .combine(sessionStore.session) { state, session ->
            state.copy(session = session, ready = true)
        }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AppUiState())

    private val messageCache = mutableMapOf<String, List<DisplayMessage>>()
    private val activeStreams = mutableMapOf<String, RunningStream>()
    private var lastValidatedToken: String? = null

    init {
        viewModelScope.launch {
            sessionStore.session.collect { session ->
                mutableState.update { it.copy(session = session, ready = true) }
                if (session.authenticated && session.token != lastValidatedToken) {
                    lastValidatedToken = session.token
                    validateAndLoad()
                }
            }
        }
    }

    fun setAuthMode(mode: AuthMode) {
        mutableState.update { it.copy(authMode = mode, message = null) }
    }

    fun setMainTab(tab: MainTab) {
        mutableState.update { it.copy(mainTab = tab, message = null) }
        if (tab != MainTab.Chats) {
            viewModelScope.launch {
                runAction("加载失败") { loadWorkspace(selectInitial = false) }
            }
        }
    }

    fun setChatSearch(query: String) {
        mutableState.update { it.copy(chatSearch = query) }
    }

    fun showChatList() {
        clearActiveChat()
    }

    fun clearMessage() {
        mutableState.update { it.copy(message = null) }
    }

    fun saveBaseUrl(baseUrl: String) {
        viewModelScope.launch { sessionStore.saveBaseUrl(baseUrl) }
    }

    fun login(account: String, password: String, baseUrl: String) {
        viewModelScope.launch {
            runAction("登录失败") {
                sessionStore.saveBaseUrl(baseUrl)
                authRepository.login(account.trim(), password)
                loadWorkspace(selectInitial = false)
            }
        }
    }

    fun register(account: String, password: String, baseUrl: String) {
        viewModelScope.launch {
            runAction("注册失败") {
                sessionStore.saveBaseUrl(baseUrl)
                authRepository.register(account.trim(), password)
                loadWorkspace(selectInitial = false)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            detachAll()
            authRepository.logout()
            messageCache.clear()
            mutableState.update { AppUiState(ready = true, session = it.session.copy(token = null, user = null)) }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            runAction("刷新失败") { loadWorkspace(selectInitial = false) }
        }
    }

    private suspend fun validateAndLoad() {
        runAction("加载失败") {
            authRepository.me()
            loadWorkspace(selectInitial = false)
        }
    }

    suspend fun loadWorkspace(selectInitial: Boolean = false) {
        mutableState.update { it.copy(loading = true, message = null) }
        val providers = providerRepository.list()
        val agents = agentRepository.list()
        val agentChats = agentChatRepository.list()
        val groupChats = groupChatRepository.list()
        mutableState.update {
            it.copy(
                providers = providers,
                agents = agents,
                agentChats = agentChats,
                groupChats = groupChats,
                loading = false
            )
        }
        syncWatchers()
        if (selectInitial) {
            val items = chatItems()
            val current = mutableState.value.activeKey
            val next = if (current != null && items.any { it.key == current }) current else items.firstOrNull()?.key
            if (next != null) selectChat(next) else clearActiveChat()
        }
    }

    fun chatItems(): List<ChatListItem> =
        deriveChatItems(
            mutableState.value.agentChats,
            mutableState.value.groupChats,
            mutableState.value.runningKeys,
            mutableState.value.chatSearch
        )

    fun selectChat(key: String) {
        viewModelScope.launch {
            mutableState.update {
                it.copy(
                    activeKey = key,
                    messages = messageCache[key].orEmpty(),
                    messagesLoading = !messageCache.containsKey(key),
                    runtime = RuntimeState(),
                    blackboard = null,
                    artifactPreview = ArtifactPreviewState()
                )
            }
            runCatching { loadMessages(key) }
                .onFailure { err ->
                    mutableState.update { it.copy(messagesLoading = false) }
                    appendSystem(key, errorMessage(err, "加载消息失败"))
                }
            if (sessionKind(key) == "group") loadBlackboard(sessionRawId(key))
            syncActiveWatcher(key)
        }
    }

    private suspend fun loadMessages(key: String) {
        val userName = currentUserName()
        val kind = sessionKind(key)
        val rawId = sessionRawId(key)
        val existingRun = messageCache[key].orEmpty().activeRunMessage()
        val messages = if (kind == "agent") {
            val chat = mutableState.value.agentChats.find { it.id == rawId } ?: run {
                if (mutableState.value.activeKey == key) mutableState.update { it.copy(messagesLoading = false) }
                return
            }
            val loaded = agentChatRepository.messages(rawId).map { agentMessageToDisplay(it, chat, userName) }
            loaded.withActivePlaceholder(
                existing = existingRun,
                active = chat.activeTurnId != null,
                chatId = chat.id,
                sender = SenderInfo(chat.agent.id, chat.agent.name, "agent", chat.agent.color, chat.agent.avatar),
                label = "继续观看运行中"
            )
        } else {
            val group = mutableState.value.groupChats.find { it.id == rawId } ?: run {
                if (mutableState.value.activeKey == key) mutableState.update { it.copy(messagesLoading = false) }
                return
            }
            val loaded = groupChatRepository.messages(rawId).map { groupMessageToDisplay(it, group.members, userName) }
            loaded.withActivePlaceholder(
                existing = existingRun,
                active = group.activeRunId != null,
                chatId = group.id,
                sender = SenderInfo("orchestrator", "Orchestrator", "orchestrator", "#7b61ff"),
                label = "继续观看群聊运行"
            )
        }
        messageCache[key] = messages
        if (mutableState.value.activeKey == key) {
            mutableState.update { it.copy(messages = messages, messagesLoading = false) }
        }
    }

    private suspend fun loadBlackboard(groupId: String) {
        runCatching { groupChatRepository.blackboard(groupId) }
            .onSuccess { board ->
                if (mutableState.value.activeKey == sessionKey("group", groupId)) {
                    mutableState.update { it.copy(blackboard = board) }
                }
            }
    }

    /** Open the artifact preview sheet and fetch its content for the active group. */
    fun openArtifactPreview(artifact: BlackboardArtifact) {
        val key = mutableState.value.activeKey ?: return
        if (sessionKind(key) != "group") return
        val groupId = sessionRawId(key)
        mutableState.update {
            it.copy(artifactPreview = ArtifactPreviewState(artifact = artifact, loading = true))
        }
        viewModelScope.launch {
            runCatching { groupChatRepository.artifactPreview(groupId, artifact.id) }
                .onSuccess { preview ->
                    mutableState.update { state ->
                        if (state.artifactPreview.artifact?.id != artifact.id) state
                        else state.copy(artifactPreview = state.artifactPreview.copy(loading = false, preview = preview, error = null))
                    }
                }
                .onFailure { err ->
                    mutableState.update { state ->
                        if (state.artifactPreview.artifact?.id != artifact.id) state
                        else state.copy(artifactPreview = state.artifactPreview.copy(loading = false, error = errorMessage(err, "加载预览失败")))
                    }
                }
        }
    }

    fun closeArtifactPreview() {
        mutableState.update { it.copy(artifactPreview = ArtifactPreviewState()) }
    }

    fun sendMessage(text: String) {
        val trimmed = text.trim()
        val key = mutableState.value.activeKey ?: return
        if (trimmed.isBlank() || mutableState.value.runningKeys.contains(key)) return
        viewModelScope.launch {
            when (sessionKind(key)) {
                "agent" -> sendAgentMessage(key, trimmed)
                "group" -> sendGroupMessage(key, trimmed)
            }
        }
    }

    private suspend fun sendAgentMessage(key: String, text: String) {
        val chatId = sessionRawId(key)
        val chat = mutableState.value.agentChats.find { it.id == chatId } ?: return
        if (chat.archivedAt != null) return
        appendLocalMessage(
            key,
            TextDisplayMessage(
                id = "local-user-${System.nanoTime()}",
                chatId = chatId,
                timestamp = java.time.Instant.now().toString(),
                sender = SenderInfo("me", currentUserName(), "user"),
                text = text
            )
        )
        val runMessage = buildInitialRunMessage(
            chatId = chatId,
            sender = SenderInfo(chat.agent.id, chat.agent.name, "agent", chat.agent.color, chat.agent.avatar)
        )
        appendLocalMessage(key, runMessage)
        markRunning(key, true)
        try {
            val result = agentChatRepository.converse(chatId, text)
            subscribeAgentTurn(chat, result.turnId, key)
        } catch (err: Throwable) {
            markRunning(key, false)
            appendSystem(key, errorMessage(err, "发送失败"))
        }
    }

    private suspend fun sendGroupMessage(key: String, text: String) {
        val groupId = sessionRawId(key)
        val group = mutableState.value.groupChats.find { it.id == groupId } ?: return
        if (group.archivedAt != null || group.status == "archived") return
        appendLocalMessage(
            key,
            TextDisplayMessage(
                id = "local-user-${System.nanoTime()}",
                chatId = groupId,
                timestamp = java.time.Instant.now().toString(),
                sender = SenderInfo("me", currentUserName(), "user"),
                text = text
            )
        )
        val runMessage = buildInitialRunMessage(
            chatId = groupId,
            sender = SenderInfo("orchestrator", "Orchestrator", "orchestrator", "#7b61ff"),
            label = "Orchestrator 编排中"
        )
        appendLocalMessage(key, runMessage)
        markRunning(key, true)
        try {
            val result = groupChatRepository.converse(groupId, text)
            subscribeGroupRun(group, result.runId, key)
        } catch (err: Throwable) {
            markRunning(key, false)
            appendSystem(key, errorMessage(err, "发送失败"))
        }
    }

    fun stopActiveRun() {
        val key = mutableState.value.activeKey ?: return
        viewModelScope.launch {
            when (sessionKind(key)) {
                "agent" -> activeStreams[key]?.id?.let { turnId ->
                    runCatching { agentChatRepository.abortTurn(sessionRawId(key), turnId) }
                }
                "group" -> activeStreams[key]?.id?.let { runId ->
                    runCatching { groupChatRepository.abortRun(sessionRawId(key), runId) }
                }
            }
            activeStreams.remove(key)?.handle?.close()
            markRunning(key, false)
        }
    }

    fun togglePin(item: ChatListItem) {
        viewModelScope.launch {
            runAction("更新失败") {
                if (item.kind == "agent") {
                    val next = agentChatRepository.update(item.rawId, UpdateChatPayload(isPinned = !item.pinned))
                    mutableState.update { state -> state.copy(agentChats = state.agentChats.map { if (it.id == next.id) next else it }) }
                } else {
                    val next = groupChatRepository.update(item.rawId, UpdateChatPayload(isPinned = !item.pinned))
                    mutableState.update { state -> state.copy(groupChats = state.groupChats.map { if (it.id == next.id) next else it }) }
                }
            }
        }
    }

    fun toggleArchive(item: ChatListItem) {
        viewModelScope.launch {
            runAction("更新失败") {
                if (item.kind == "agent") {
                    val next = agentChatRepository.update(item.rawId, UpdateChatPayload(archived = !item.archived))
                    mutableState.update { state -> state.copy(agentChats = state.agentChats.map { if (it.id == next.id) next else it }) }
                } else {
                    val next = groupChatRepository.update(item.rawId, UpdateChatPayload(archived = !item.archived))
                    mutableState.update { state -> state.copy(groupChats = state.groupChats.map { if (it.id == next.id) next else it }) }
                }
            }
        }
    }

    fun deleteChat(item: ChatListItem) {
        viewModelScope.launch {
            runAction("删除失败") {
                activeStreams.remove(item.key)?.handle?.close()
                markRunning(item.key, false)
                if (item.kind == "agent") {
                    agentChatRepository.delete(item.rawId)
                    mutableState.update { state -> state.copy(agentChats = state.agentChats.filterNot { it.id == item.rawId }) }
                } else {
                    groupChatRepository.delete(item.rawId)
                    mutableState.update { state -> state.copy(groupChats = state.groupChats.filterNot { it.id == item.rawId }) }
                }
                messageCache.remove(item.key)
                if (mutableState.value.activeKey == item.key) {
                    val next = chatItems().firstOrNull()?.key
                    if (next != null) selectChat(next) else clearActiveChat()
                }
            }
        }
    }

    fun createAgent(payload: CreateAgentPayload, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runAction("创建 Agent 失败") {
                agentRepository.create(payload)
                loadWorkspace(selectInitial = false)
                onDone()
            }
        }
    }

    fun deleteAgent(agentId: String) {
        viewModelScope.launch {
            runAction("删除 Agent 失败") {
                agentRepository.delete(agentId)
                loadWorkspace(selectInitial = false)
            }
        }
    }

    fun createAgentChat(payload: CreateAgentChatPayload, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runAction("创建聊天失败") {
                val chat = agentChatRepository.create(payload)
                loadWorkspace(selectInitial = false)
                onDone()
                selectChat(sessionKey("agent", chat.id))
                mutableState.update { it.copy(mainTab = MainTab.Chats) }
            }
        }
    }

    fun createGroupChat(payload: CreateGroupChatPayload, onDone: () -> Unit = {}) {
        viewModelScope.launch {
            runAction("创建群聊失败") {
                val group = groupChatRepository.create(payload)
                loadWorkspace(selectInitial = false)
                onDone()
                selectChat(sessionKey("group", group.id))
                mutableState.update { it.copy(mainTab = MainTab.Chats) }
            }
        }
    }

    fun openDirectoryPicker(
        target: DirectoryTarget,
        title: String,
        mode: DirectoryMode = DirectoryMode.Single,
        preferredKind: String? = "agent_workspace",
        initialPaths: List<String> = emptyList()
    ) {
        viewModelScope.launch {
            mutableState.update {
                it.copy(
                    directoryPicker = DirectoryPickerState(
                        open = true,
                        target = target,
                        title = title,
                        mode = mode,
                        preferredKind = preferredKind,
                        pathDraft = initialPaths.firstOrNull().orEmpty(),
                        selectedPaths = initialPaths,
                        loading = true
                    )
                )
            }
            runCatching {
                val roots = workspaceFsRepository.roots()
                val initialPath = initialPaths.firstOrNull()
                    ?: roots.find { it.kind == preferredKind }?.path
                    ?: roots.firstOrNull()?.path
                val listing = workspaceFsRepository.directories(initialPath)
                mutableState.update { state ->
                    state.copy(
                        directoryPicker = state.directoryPicker.copy(
                            roots = roots,
                            listing = listing,
                            pathDraft = listing.path,
                            loading = false
                        )
                    )
                }
            }.onFailure { err ->
                mutableState.update { state ->
                    state.copy(directoryPicker = state.directoryPicker.copy(loading = false, error = errorMessage(err, "加载服务器目录失败")))
                }
            }
        }
    }

    fun closeDirectoryPicker() {
        mutableState.update { it.copy(directoryPicker = DirectoryPickerState()) }
    }

    fun openDirectory(path: String?) {
        viewModelScope.launch {
            mutableState.update { it.copy(directoryPicker = it.directoryPicker.copy(loading = true, error = null)) }
            runCatching { workspaceFsRepository.directories(path) }
                .onSuccess { listing ->
                    mutableState.update {
                        it.copy(
                            directoryPicker = it.directoryPicker.copy(
                                listing = listing,
                                pathDraft = listing.path,
                                newFolderOpen = false,
                                newFolderName = "",
                                newFolderError = null,
                                loading = false
                            )
                        )
                    }
                }
                .onFailure { err ->
                    mutableState.update { it.copy(directoryPicker = it.directoryPicker.copy(loading = false, error = errorMessage(err, "读取服务器目录失败"))) }
                }
        }
    }

    fun updateDirectoryPathDraft(path: String) {
        mutableState.update { it.copy(directoryPicker = it.directoryPicker.copy(pathDraft = path)) }
    }

    fun openDirectoryDraft() {
        val picker = mutableState.value.directoryPicker
        val path = picker.pathDraft.trim().ifBlank { picker.listing?.path.orEmpty() }
        if (path.isNotBlank()) openDirectory(path)
    }

    fun toggleDirectorySelection(path: String) {
        mutableState.update { state ->
            val picker = state.directoryPicker
            val selected = picker.selectedPaths.toMutableList()
            if (picker.mode == DirectoryMode.Single) {
                selected.clear()
                selected.add(path)
            } else if (selected.contains(path)) {
                selected.remove(path)
            } else {
                selected.add(path)
            }
            state.copy(directoryPicker = picker.copy(selectedPaths = selected.distinct()))
        }
    }

    fun openNewFolderEditor() {
        mutableState.update {
            it.copy(
                directoryPicker = it.directoryPicker.copy(
                    newFolderOpen = true,
                    newFolderName = "",
                    newFolderError = null
                )
            )
        }
    }

    fun closeNewFolderEditor() {
        mutableState.update {
            it.copy(
                directoryPicker = it.directoryPicker.copy(
                    newFolderOpen = false,
                    newFolderName = "",
                    newFolderError = null
                )
            )
        }
    }

    fun updateNewFolderName(name: String) {
        mutableState.update {
            it.copy(directoryPicker = it.directoryPicker.copy(newFolderName = name, newFolderError = null))
        }
    }

    fun useNewFolderPath() {
        val picker = mutableState.value.directoryPicker
        val name = picker.newFolderName.trim()
        val base = picker.listing?.path ?: picker.pathDraft.trim()
        val error = when {
            name.isBlank() -> "请输入文件夹名称"
            name == "." || name == ".." || name.contains('/') || name.contains('\\') -> "文件夹名称不能包含路径分隔符"
            base.isBlank() -> "请先选择服务器目录"
            else -> null
        }
        if (error != null) {
            mutableState.update { it.copy(directoryPicker = it.directoryPicker.copy(newFolderError = error)) }
            return
        }

        val path = joinServerPath(base, name)
        mutableState.update { state ->
            val pickerState = state.directoryPicker
            val selected = if (pickerState.mode == DirectoryMode.Multiple) {
                (pickerState.selectedPaths + path).distinct()
            } else {
                pickerState.selectedPaths
            }
            state.copy(
                directoryPicker = pickerState.copy(
                    pathDraft = path,
                    selectedPaths = selected,
                    newFolderOpen = false,
                    newFolderName = "",
                    newFolderError = null
                )
            )
        }
    }

    fun confirmDirectorySelection() {
        val picker = mutableState.value.directoryPicker
        val current = picker.pathDraft.trim().ifBlank { picker.listing?.path.orEmpty() }
        val selected = if (picker.selectedPaths.isNotEmpty()) picker.selectedPaths else listOf(current).filter { it.isNotBlank() }
        mutableState.update { state ->
            state.copy(
                pickedPaths = state.pickedPaths + (picker.target to selected),
                directoryPicker = DirectoryPickerState()
            )
        }
    }

    fun consumePickedPaths(target: DirectoryTarget): List<String> {
        val value = mutableState.value.pickedPaths[target].orEmpty()
        if (value.isNotEmpty()) {
            mutableState.update { it.copy(pickedPaths = it.pickedPaths - target) }
        }
        return value
    }

    private suspend fun subscribeAgentTurn(chat: AgentChatView, turnId: String, key: String) {
        activeStreams.remove(key)?.handle?.close()
        ensureRunPlaceholder(
            key = key,
            chatId = chat.id,
            sender = SenderInfo(chat.agent.id, chat.agent.name, "agent", chat.agent.color, chat.agent.avatar),
            label = "继续观看运行中"
        )
        val handle = agentChatRepository.subscribeTurn(
            id = chat.id,
            turnId = turnId,
            onEvent = { event ->
                viewModelScope.launch { onAgentEvent(key, event) }
            },
            onError = { message ->
                viewModelScope.launch {
                    appendSystem(key, message)
                    markRunning(key, false)
                }
            },
            onDone = {
                viewModelScope.launch {
                    activeStreams.remove(key)
                    markRunning(key, false)
                    reloadAfterRun(key)
                }
            }
        )
        activeStreams[key] = RunningStream(turnId, handle)
    }

    private suspend fun subscribeGroupRun(group: GroupChatView, runId: String, key: String) {
        activeStreams.remove(key)?.handle?.close()
        ensureRunPlaceholder(
            key = key,
            chatId = group.id,
            sender = SenderInfo("orchestrator", "Orchestrator", "orchestrator", "#7b61ff"),
            label = "继续观看群聊运行"
        )
        val handle = groupChatRepository.subscribeRun(
            id = group.id,
            runId = runId,
            onEvent = { event ->
                viewModelScope.launch { onGroupEvent(key, event) }
            },
            onError = { message ->
                viewModelScope.launch {
                    appendSystem(key, message)
                    markRunning(key, false)
                }
            },
            onDone = {
                viewModelScope.launch {
                    activeStreams.remove(key)
                    markRunning(key, false)
                    reloadAfterRun(key)
                    loadBlackboard(group.id)
                }
            }
        )
        activeStreams[key] = RunningStream(runId, handle)
    }

    private suspend fun onAgentEvent(key: String, event: JsonElement) {
        mutableState.update { it.copy(runtime = reduceRuntime(it.runtime, event)) }
        updateLastRunMessage(key) { reduceAgentRun(it, event) }
    }

    private suspend fun onGroupEvent(key: String, event: JsonElement) {
        val type = event.jsonObject["type"]?.jsonPrimitive?.contentOrNull
        val runtimeLabel = groupRuntimeLabel(event)
        if (runtimeLabel != null) {
            mutableState.update {
                it.copy(runtime = it.runtime.copy(phase = if (type == "done") "done" else "thinking", label = runtimeLabel))
            }
        }
        val inner = if (type == "member_turn_event") event.jsonObject["event"] else null
        if (inner != null) {
            updateLastRunMessage(key) { reduceAgentRun(it, inner) }
        } else if (type == "task_status") {
            val status = event.jsonObject["status"]?.jsonPrimitive?.contentOrNull
            val summary = event.jsonObject["summary"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
            val terminalStatuses = setOf("done", "failed", "blocked", "waiting_input")
            if (summary.isNotBlank() && status != null && status in terminalStatuses) {
                updateLastRunMessage(key) {
                    val nextText = listOf(it.text, summary)
                        .filter { text -> text.isNotBlank() }
                        .distinct()
                        .joinToString("\n\n")
                    it.copy(
                        status = if (status == "failed" || status == "blocked") "error" else "responding",
                        text = nextText
                    )
                }
            }
        } else if (type == "orchestrator_report") {
            val text = event.jsonObject["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
            updateLastRunMessage(key) { it.copy(status = "responding", text = listOf(it.text, text).filter { v -> v.isNotBlank() }.joinToString("\n\n")) }
        } else if (type == "done") {
            val success = event.jsonObject["success"]?.jsonPrimitive?.booleanOrNull != false
            updateLastRunMessage(key) { it.copy(status = if (success) "done" else "error") }
        }
    }

    private fun updateLastRunMessage(key: String, update: (AgentRunDisplayMessage) -> AgentRunDisplayMessage) {
        val cached = messageCache[key].orEmpty()
        val next = cached.mapIndexed { index, message ->
            if (index == cached.indexOfLast { it is AgentRunDisplayMessage } && message is AgentRunDisplayMessage) update(message) else message
        }
        messageCache[key] = next
        if (mutableState.value.activeKey == key) mutableState.update { it.copy(messages = next) }
    }

    private fun ensureRunPlaceholder(key: String, chatId: String, sender: SenderInfo, label: String) {
        if (messageCache[key].orEmpty().activeRunMessage() != null) {
            return
        }
        appendLocalMessage(key, buildInitialRunMessage(chatId = chatId, sender = sender, label = label))
    }

    private fun List<DisplayMessage>.withActivePlaceholder(
        existing: AgentRunDisplayMessage?,
        active: Boolean,
        chatId: String,
        sender: SenderInfo,
        label: String
    ): List<DisplayMessage> {
        if (!active || activeRunMessage() != null) return this
        return this + (existing ?: buildInitialRunMessage(chatId = chatId, sender = sender, label = label))
    }

    private fun List<DisplayMessage>.activeRunMessage(): AgentRunDisplayMessage? =
        filterIsInstance<AgentRunDisplayMessage>().lastOrNull { it.status != "done" && it.status != "error" }

    private suspend fun reloadAfterRun(key: String) {
        runCatching {
            loadWorkspace(selectInitial = false)
            loadMessages(key)
        }
    }

    private fun appendLocalMessage(key: String, message: DisplayMessage) {
        val next = messageCache[key].orEmpty() + message
        messageCache[key] = next
        if (mutableState.value.activeKey == key) mutableState.update { it.copy(messages = next) }
    }

    private fun appendSystem(key: String, text: String) {
        appendLocalMessage(
            key,
            SystemDisplayMessage(
                id = "system-${System.nanoTime()}",
                chatId = sessionRawId(key),
                timestamp = java.time.Instant.now().toString(),
                text = text
            )
        )
    }

    private suspend fun syncWatchers() {
        for (chat in mutableState.value.agentChats) {
            val turnId = chat.activeTurnId ?: continue
            val key = sessionKey("agent", chat.id)
            if (activeStreams[key]?.id != turnId) {
                subscribeAgentTurn(chat, turnId, key)
                markRunning(key, true)
            }
        }
        for (group in mutableState.value.groupChats) {
            val runId = group.activeRunId ?: continue
            val key = sessionKey("group", group.id)
            if (activeStreams[key]?.id != runId) {
                subscribeGroupRun(group, runId, key)
                markRunning(key, true)
            }
        }
    }

    private suspend fun syncActiveWatcher(key: String) {
        when (sessionKind(key)) {
            "agent" -> {
                val chat = mutableState.value.agentChats.find { it.id == sessionRawId(key) }
                val turnId = chat?.activeTurnId
                if (chat != null && turnId != null && activeStreams[key]?.id != turnId) {
                    subscribeAgentTurn(chat, turnId, key)
                    markRunning(key, true)
                }
            }
            "group" -> {
                val group = mutableState.value.groupChats.find { it.id == sessionRawId(key) }
                val runId = group?.activeRunId
                if (group != null && runId != null && activeStreams[key]?.id != runId) {
                    subscribeGroupRun(group, runId, key)
                    markRunning(key, true)
                }
            }
        }
    }

    private fun clearActiveChat() {
        mutableState.update {
            it.copy(activeKey = null, messages = emptyList(), messagesLoading = false, runtime = RuntimeState(), blackboard = null, artifactPreview = ArtifactPreviewState())
        }
    }

    private fun markRunning(key: String, running: Boolean) {
        mutableState.update { state ->
            val next = if (running) state.runningKeys + key else state.runningKeys - key
            state.copy(runningKeys = next)
        }
    }

    private suspend fun detachAll() {
        activeStreams.values.forEach { it.handle.close() }
        activeStreams.clear()
        mutableState.update { it.copy(runningKeys = emptySet()) }
    }

    private suspend fun runAction(fallback: String, block: suspend () -> Unit) {
        mutableState.update { it.copy(loading = true, message = null) }
        try {
            block()
            mutableState.update { it.copy(loading = false) }
        } catch (err: Throwable) {
            mutableState.update { it.copy(loading = false, message = errorMessage(err, fallback)) }
        }
    }

    private fun currentUserName(): String {
        val user = mutableState.value.session.user
        return user?.nickname?.trim()?.takeIf { it.isNotBlank() } ?: user?.account ?: "我"
    }

    private fun errorMessage(err: Throwable, fallback: String): String =
        if (err is ApiException) err.message else err.message?.takeIf { it.isNotBlank() } ?: fallback

    private fun joinServerPath(base: String, name: String): String {
        val trimmedBase = base.trim().trimEnd('/', '\\')
        val separator = if (base.contains('\\')) "\\" else "/"
        return if (trimmedBase.matches(Regex("^[A-Za-z]:$"))) {
            "$trimmedBase$separator${name.trim()}"
        } else {
            "${trimmedBase.ifBlank { separator }}${if (trimmedBase.isBlank()) "" else separator}${name.trim()}"
        }
    }

    override fun onCleared() {
        activeStreams.values.forEach { it.handle.close() }
        activeStreams.clear()
        super.onCleared()
    }

    @OptIn(ExperimentalSerializationApi::class)
    companion object {
        fun factory(context: Context): ViewModelProvider.Factory {
            val appContext = context.applicationContext
            val json = Json {
                ignoreUnknownKeys = true
                explicitNulls = false
                encodeDefaults = false
                coerceInputValues = true
            }
            val sessionStore = SessionStore(appContext, json)
            val apiClient = ApiClient(sessionStore, json, OkHttpClient.Builder().build())
            val authRepository = AuthRepository(apiClient, sessionStore)
            return object : ViewModelProvider.Factory {
                @Suppress("UNCHECKED_CAST")
                override fun <T : ViewModel> create(modelClass: Class<T>): T =
                    AppViewModel(
                        sessionStore = sessionStore,
                        authRepository = authRepository,
                        providerRepository = ProviderRepository(apiClient),
                        agentRepository = AgentRepository(apiClient),
                        agentChatRepository = AgentChatRepository(apiClient),
                        groupChatRepository = GroupChatRepository(apiClient),
                        workspaceFsRepository = WorkspaceFsRepository(apiClient)
                    ) as T
            }
        }
    }
}
