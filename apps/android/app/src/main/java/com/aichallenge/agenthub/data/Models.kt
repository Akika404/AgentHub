package com.aichallenge.agenthub.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

const val SUCCESS_CODE = 0
const val UNAUTHORIZED_CODE = 2001
const val DEFAULT_API_BASE_URL = "http://10.0.2.2:3000/api"

@Serializable
data class ApiResponse<T>(
    val code: Int,
    val message: String,
    val data: T? = null,
    val timestamp: String
)

@Serializable
data class LoginPayload(val account: String, val password: String)

@Serializable
data class RegisterPayload(val account: String, val password: String)

@Serializable
data class LoginResult(val token: String, val expiresIn: Int, val user: UserView)

@Serializable
data class UserView(
    val id: String,
    val account: String,
    val nickname: String? = null,
    val email: String? = null,
    val avatar: String? = null,
    val status: String,
    val createdAt: String
)

@Serializable
data class PlatformProviderView(
    val id: String,
    val platformName: String,
    val type: String,
    val baseUrl: String,
    val modelList: List<String> = emptyList(),
    val apiKeyMasked: String? = null,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class AgentCapabilities(
    val supportsSystemPrompt: Boolean = true,
    val supportsSkills: Boolean = true,
    val supportsMcp: Boolean = false,
    val supportsResumeById: Boolean = true
)

val VENDOR_CAPABILITIES = mapOf(
    "claude" to AgentCapabilities(
        supportsSystemPrompt = true,
        supportsSkills = true,
        supportsMcp = true,
        supportsResumeById = true
    ),
    "codex" to AgentCapabilities(
        supportsSystemPrompt = true,
        supportsSkills = true,
        supportsMcp = false,
        supportsResumeById = true
    )
)

fun vendorLabel(vendor: String): String = when (vendor) {
    "claude" -> "Claude"
    "codex" -> "Codex"
    else -> vendor
}

fun isVendorProviderCompatible(vendor: String, providerType: String): Boolean =
    if (vendor == "claude") providerType == "anthropic"
    else providerType == "openai-responses" || providerType == "openai-chat-completions"

@Serializable
data class AgentView(
    val id: String,
    val name: String,
    val avatar: String? = null,
    val color: String,
    val capabilitySummary: String? = null,
    val vendor: String,
    val platformProviderId: String,
    val model: String,
    val agentHomeDirectory: String,
    val workingDirectory: String,
    val capabilities: AgentCapabilities = VENDOR_CAPABILITIES["codex"]!!,
    val createdAt: String,
    val updatedAt: String,
    val systemPrompt: String? = null,
    val skills: JsonElement? = null,
    val mcpServers: JsonObject? = null,
    val allowedTools: List<String>? = null,
    val permissionMode: String? = null,
    val reasoningEffort: String? = null
)

@Serializable
data class AgentChatAgentSummary(
    val id: String,
    val name: String,
    val avatar: String? = null,
    val color: String,
    val vendor: String,
    val model: String,
    val capabilities: AgentCapabilities = VENDOR_CAPABILITIES["codex"]!!
)

@Serializable
data class AgentChatView(
    val id: String,
    val agentId: String,
    val agent: AgentChatAgentSummary,
    val title: String? = null,
    val workingDirectory: String,
    val sessionHomeDirectory: String,
    val skills: JsonElement? = null,
    val mcpServers: JsonObject? = null,
    val status: String,
    val isPinned: Boolean,
    val archivedAt: String? = null,
    val hasLiveSession: Boolean,
    val activeTurnId: String? = null,
    val lastTurnAt: String? = null,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class AgentTodoItem(val text: String, val status: String)

@Serializable
data class AgentRunStepView(
    val id: String,
    val seq: Int,
    val type: String,
    val text: String? = null,
    val toolName: String? = null,
    val toolUseId: String? = null,
    val toolStatus: String? = null,
    val input: JsonElement? = null,
    val output: JsonElement? = null,
    val isError: Boolean? = null,
    val todos: List<AgentTodoItem>? = null
)

@Serializable
data class AgentChatMessageView(
    val id: String,
    val chatId: String,
    val agentId: String,
    val role: String,
    val text: String,
    val createdAt: String,
    val steps: List<AgentRunStepView> = emptyList(),
    val replyTo: MessageReplyRef? = null
)

@Serializable
data class MessageReplyRef(
    val messageId: String,
    val senderName: String,
    val excerpt: String
)

@Serializable
data class CreateAgentPayload(
    val name: String,
    val avatar: String? = null,
    val color: String? = null,
    val capabilitySummary: String? = null,
    val vendor: String,
    val platformProviderId: String,
    val model: String,
    val agentHomeDirectory: String? = null,
    val workingDirectory: String,
    val systemPrompt: String? = null,
    val skillSourceDirectories: List<String>? = null,
    val skills: JsonElement? = null,
    val mcpServers: JsonObject? = null,
    val allowedTools: List<String>? = null,
    val permissionMode: String? = null,
    val reasoningEffort: String? = null
)

@Serializable
data class CreateAgentChatPayload(
    val agentId: String,
    val title: String? = null,
    val workingDirectory: String? = null,
    val skillSourceDirectories: List<String>? = null,
    val mcpServers: JsonObject? = null
)

@Serializable
data class UpdateChatPayload(val isPinned: Boolean? = null, val archived: Boolean? = null)

@Serializable
data class StartTurnResult(val turnId: String)

@Serializable
data class ConversePayload(val prompt: String, val replyTo: MessageReplyRef? = null)

@Serializable
data class DeletedResult(val deleted: Boolean? = null, val aborted: Boolean? = null)

@Serializable
data class ProjectMeta(
    val name: String,
    val goal: String? = null,
    val techStack: List<String> = emptyList(),
    val status: String = "planning"
)

@Serializable
data class OrchestratorConfig(val vendor: String, val model: String, val providerId: String)

@Serializable
data class GroupMemberView(
    val agentId: String,
    val name: String,
    val avatar: String? = null,
    val color: String,
    val vendor: String,
    val capabilities: AgentCapabilities = VENDOR_CAPABILITIES["codex"]!!,
    val roleInGroup: String? = null,
    val capabilitySummary: String? = null
)

@Serializable
data class GroupChatView(
    val id: String,
    val title: String,
    val status: String,
    val isPinned: Boolean,
    val archivedAt: String? = null,
    val workspaceDir: String,
    val orchestrator: OrchestratorConfig,
    val members: List<GroupMemberView> = emptyList(),
    val projectMeta: ProjectMeta,
    val activeRunId: String? = null,
    val createdAt: String,
    val updatedAt: String
)

@Serializable
data class CreateGroupChatPayload(
    val title: String,
    val memberAgentIds: List<String>,
    val orchestrator: OrchestratorConfig,
    val projectMeta: ProjectMeta,
    val workspaceDir: String? = null
)

@Serializable
data class ConverseGroupPayload(
    val text: String,
    val mentions: List<String>? = null,
    val replyTo: MessageReplyRef? = null
)

@Serializable
data class StartGroupRunResult(val runId: String)

@Serializable
data class TaskItem(val id: String, val title: String, val status: String)

@Serializable
data class OptionItem(val id: String, val label: String, val selected: Boolean? = null)

@Serializable
data class AgentQuestionOption(
    val id: String,
    val label: String,
    val description: String? = null
)

@Serializable
data class AgentQuestion(
    val id: String,
    val question: String,
    val header: String? = null,
    val options: List<AgentQuestionOption> = emptyList(),
    val multiSelect: Boolean? = null,
    val allowText: Boolean? = null
)

@Serializable
data class GroupMessageView(
    val id: String,
    val groupChatId: String,
    val senderRole: String,
    val senderAgentId: String? = null,
    val createdAt: String,
    val kind: String,
    val text: String? = null,
    val heading: String? = null,
    val tasks: List<TaskItem> = emptyList(),
    val options: List<OptionItem> = emptyList(),
    val answered: Boolean? = null,
    val answeredOptionId: String? = null,
    val taskId: String? = null,
    val questions: List<AgentQuestion> = emptyList(),
    val summary: String? = null,
    val answerText: String? = null,
    val replyTo: MessageReplyRef? = null
)

@Serializable
data class BlackboardTaskNode(
    val id: String,
    val name: String,
    val agentId: String? = null,
    val deps: List<String> = emptyList(),
    val status: String,
    val objective: String
)

@Serializable
data class BlackboardArtifact(
    val id: String,
    val type: String,
    val path: String,
    val ownerAgentId: String,
    val version: Int,
    val status: String,
    val summary: String,
    val updatedAt: String,
    val updatedByAgentId: String
)

@Serializable
data class BlackboardDecision(
    val id: String,
    val content: String,
    val rationale: String? = null,
    val status: String,
    val scope: String? = null,
    val supersedes: List<String> = emptyList(),
    val createdByAgentId: String,
    val approvedBy: String? = null,
    val ts: String
)

@Serializable
data class BlackboardContract(
    val id: String,
    val spec: JsonObject = JsonObject(emptyMap()),
    val ownerAgentId: String,
    val consumers: List<String> = emptyList(),
    val approvalRequired: Boolean,
    val version: Int
)

@Serializable
data class BlackboardView(
    val artifacts: List<BlackboardArtifact> = emptyList(),
    val decisions: List<BlackboardDecision> = emptyList(),
    val contracts: List<BlackboardContract> = emptyList(),
    val taskGraph: List<BlackboardTaskNode> = emptyList()
)

@Serializable
data class ServerDirectoryRoot(
    val id: String,
    val path: String,
    val label: String,
    val kind: String? = null
)

@Serializable
data class ServerDirectoryEntry(
    val name: String,
    val path: String,
    val readable: Boolean
)

@Serializable
data class ServerDirectoryListing(
    val root: ServerDirectoryRoot,
    val path: String,
    val parentPath: String? = null,
    val entries: List<ServerDirectoryEntry> = emptyList()
)

sealed interface DisplayMessage {
    val id: String
    val chatId: String
    val timestamp: String
}

data class SenderInfo(
    val id: String,
    val name: String,
    val role: String,
    val color: String? = null,
    val avatar: String? = null
)

data class TextDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val sender: SenderInfo,
    val text: String,
    val replyTo: MessageReplyRef? = null
) : DisplayMessage

data class SystemDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val text: String
) : DisplayMessage

data class TaskListDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val sender: SenderInfo,
    val heading: String,
    val tasks: List<TaskItem>
) : DisplayMessage

data class OptionsDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val sender: SenderInfo,
    val text: String,
    val options: List<OptionItem>,
    val answered: Boolean = false
) : DisplayMessage

data class AgentQuestionDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val sender: SenderInfo,
    val questions: List<AgentQuestion>,
    val summary: String,
    val answered: Boolean = false,
    val answerText: String? = null
) : DisplayMessage

data class AgentRunStep(
    val id: String,
    val type: String,
    val label: String,
    val status: String,
    val text: String? = null,
    val toolName: String? = null,
    val todos: List<AgentTodoItem> = emptyList()
)

data class AgentRunDisplayMessage(
    override val id: String,
    override val chatId: String,
    override val timestamp: String,
    val sender: SenderInfo,
    val status: String,
    val steps: List<AgentRunStep>,
    val text: String
) : DisplayMessage

data class ChatListItem(
    val key: String,
    val rawId: String,
    val kind: String,
    val title: String,
    val preview: String,
    val avatarText: String,
    val avatarColor: String? = null,
    val pinned: Boolean,
    val archived: Boolean,
    val running: Boolean,
    val updatedAt: String,
    val groupMembers: List<GroupMemberView> = emptyList()
)

data class RuntimeState(
    val phase: String = "idle",
    val label: String = "Idle",
    val detail: String? = null,
    val toolName: String? = null,
    val todos: List<AgentTodoItem> = emptyList()
)
