package com.aichallenge.agenthub.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

fun sessionKey(kind: String, id: String): String = "$kind:$id"

fun sessionKind(key: String): String = key.substringBefore(':', "")

fun sessionRawId(key: String): String = key.substringAfter(':', "")

fun agentInitials(name: String): String =
    name.trim().take(2).ifBlank { "AG" }.uppercase()

/** Hidden agent-runtime dirs that should never surface as user-facing artifacts. */
private val HIDDEN_ARTIFACT_DIRS = setOf(".codex", ".agents", ".claude")

/** Mirrors `shouldShowBlackboardArtifact` in the desktop renderer. */
fun shouldShowBlackboardArtifact(artifact: BlackboardArtifact): Boolean =
    artifact.path.split('/', '\\').none { it in HIDDEN_ARTIFACT_DIRS }

/** Last path segment, used as the artifact's display title. */
fun artifactFileName(path: String): String = path.split('/', '\\').lastOrNull()?.ifBlank { path } ?: path

/** Short human label for an artifact's preview kind. */
fun artifactKindLabel(kind: String): String = when (kind) {
    "text" -> "文本"
    "html" -> "HTML"
    "pdf" -> "PDF"
    "image" -> "图片"
    "audio" -> "音频"
    "video" -> "视频"
    "office" -> "Office"
    "too_large" -> "过大"
    "binary" -> "二进制"
    else -> "预览"
}

/** Human-readable byte size, matching the desktop `formatBytes` helper. */
fun formatBytes(size: Int): String = when {
    size < 1024 -> "$size B"
    size < 1024 * 1024 -> "${"%.1f".format(size / 1024.0)} KB"
    else -> "${"%.1f".format(size / 1024.0 / 1024.0)} MB"
}

fun titleForChat(chat: AgentChatView): String =
    chat.title?.trim()?.takeIf { it.isNotBlank() } ?: "${chat.agent.name} ${chat.createdAt.take(10)}"

fun previewForChat(chat: AgentChatView, running: Boolean): String = when {
    running -> "正在运行"
    chat.lastTurnAt != null -> "最近 ${chat.lastTurnAt.take(16).replace('T', ' ')}"
    else -> "${vendorLabel(chat.agent.vendor)} / ${chat.agent.model}"
}

fun previewForGroup(group: GroupChatView, running: Boolean): String = when {
    running -> "群聊运行中"
    !group.projectMeta.goal.isNullOrBlank() -> group.projectMeta.goal
    else -> "${group.members.size} 成员 · ${group.projectMeta.name}"
}

fun deriveChatItems(
    agentChats: List<AgentChatView>,
    groupChats: List<GroupChatView>,
    runningKeys: Set<String>,
    query: String
): List<ChatListItem> {
    val normalized = query.trim().lowercase()
    val agentItems = agentChats.map { chat ->
        val key = sessionKey("agent", chat.id)
        ChatListItem(
            key = key,
            rawId = chat.id,
            kind = "agent",
            title = titleForChat(chat),
            preview = previewForChat(chat, runningKeys.contains(key) || chat.activeTurnId != null),
            avatarText = agentInitials(chat.agent.name),
            avatarColor = chat.agent.color,
            pinned = chat.isPinned,
            archived = chat.archivedAt != null,
            running = runningKeys.contains(key) || chat.activeTurnId != null,
            updatedAt = chat.lastTurnAt ?: chat.updatedAt
        )
    }
    val groupItems = groupChats.map { group ->
        val key = sessionKey("group", group.id)
        ChatListItem(
            key = key,
            rawId = group.id,
            kind = "group",
            title = group.title,
            preview = previewForGroup(group, runningKeys.contains(key) || group.activeRunId != null),
            avatarText = "群",
            avatarColor = "#3370ff",
            pinned = group.isPinned,
            archived = group.archivedAt != null || group.status == "archived",
            running = runningKeys.contains(key) || group.activeRunId != null,
            updatedAt = group.updatedAt,
            groupMembers = group.members
        )
    }

    return (agentItems + groupItems)
        .filter {
            if (normalized.isBlank()) true
            else listOf(it.title, it.preview, it.kind).joinToString(" ").lowercase().contains(normalized)
        }
        .sortedWith(
            compareByDescending<ChatListItem> { it.pinned }
                .thenByDescending { it.updatedAt }
        )
}

fun agentMessageToDisplay(view: AgentChatMessageView, chat: AgentChatView, currentUserName: String): DisplayMessage {
    if (view.role == "system") {
        return SystemDisplayMessage(view.id, view.chatId, view.createdAt, view.text)
    }
    val sender = if (view.role == "user") {
        SenderInfo("me", currentUserName, "user")
    } else {
        SenderInfo(chat.agent.id, chat.agent.name, "agent", chat.agent.color, chat.agent.avatar)
    }
    if (view.role == "agent" && view.steps.isNotEmpty()) {
        return AgentRunDisplayMessage(
            id = view.id,
            chatId = view.chatId,
            timestamp = view.createdAt,
            sender = sender,
            status = "done",
            steps = view.steps.mapNotNull(::runStepFromView),
            text = view.text
        )
    }
    return TextDisplayMessage(view.id, view.chatId, view.createdAt, sender, view.text, view.replyTo)
}

private fun runStepFromView(view: AgentRunStepView): AgentRunStep? {
    val failed = view.isError == true || view.toolStatus == "failed"
    return when (view.type) {
        "thinking" -> AgentRunStep(view.id, "thinking", if (view.seq == 0) "思考中" else "继续思考", if (failed) "failed" else "completed", view.text)
        "progress" -> AgentRunStep(view.id, "progress", "过程输出", if (failed) "failed" else "completed", view.text)
        "tool" -> AgentRunStep(view.id, "tool", "调用 ${view.toolName ?: "工具"}", if (failed) "failed" else "completed", toolName = view.toolName)
        "todo" -> AgentRunStep(view.id, "todo", "计划", "completed", todos = view.todos.orEmpty())
        "plan" -> AgentRunStep(view.id, "plan", "计划", "completed", view.text)
        else -> null
    }
}

fun groupMessageToDisplay(view: GroupMessageView, members: List<GroupMemberView>, currentUserName: String): DisplayMessage {
    val baseChatId = view.groupChatId
    if (view.kind == "system" || view.senderRole == "system") {
        return SystemDisplayMessage(view.id, baseChatId, view.createdAt, view.text.orEmpty())
    }
    val member = view.senderAgentId?.let { id -> members.find { it.agentId == id } }
    val sender = when (view.senderRole) {
        "user" -> SenderInfo("me", currentUserName, "user")
        "orchestrator" -> SenderInfo("orchestrator", "Orchestrator", "orchestrator", "#7b61ff")
        else -> SenderInfo(
            view.senderAgentId ?: "agent",
            member?.name ?: "Agent",
            "agent",
            member?.color,
            member?.avatar
        )
    }
    return when (view.kind) {
        "task-list" -> TaskListDisplayMessage(view.id, baseChatId, view.createdAt, sender, view.heading ?: "任务", view.tasks)
        "options" -> OptionsDisplayMessage(view.id, baseChatId, view.createdAt, sender, view.text.orEmpty(), view.options, view.answered == true)
        "agent-question" -> AgentQuestionDisplayMessage(
            view.id,
            baseChatId,
            view.createdAt,
            sender,
            view.questions,
            view.summary ?: "需要你的输入",
            view.answered == true,
            view.answerText
        )
        "deploy" -> if (view.manifest != null) {
            DeployDisplayMessage(view.id, baseChatId, view.createdAt, sender, view.manifest, view.artifacts)
        } else {
            TextDisplayMessage(view.id, baseChatId, view.createdAt, sender, view.text.orEmpty(), view.replyTo)
        }
        else -> {
            val steps = view.steps.mapNotNull(::runStepFromView)
            if (view.senderRole == "agent" && steps.isNotEmpty()) {
                AgentRunDisplayMessage(
                    id = view.id,
                    chatId = baseChatId,
                    timestamp = view.createdAt,
                    sender = sender,
                    status = "done",
                    steps = steps,
                    text = view.text.orEmpty()
                )
            } else {
                TextDisplayMessage(view.id, baseChatId, view.createdAt, sender, view.text.orEmpty(), view.replyTo)
            }
        }
    }
}

fun buildInitialRunMessage(chatId: String, sender: SenderInfo, label: String = "思考中"): AgentRunDisplayMessage =
    AgentRunDisplayMessage(
        id = "run-${System.currentTimeMillis()}",
        chatId = chatId,
        timestamp = nowIsoText(),
        sender = sender,
        status = "thinking",
        steps = listOf(AgentRunStep("step-${System.currentTimeMillis()}", "thinking", label, "active")),
        text = ""
    )

fun reduceAgentRun(message: AgentRunDisplayMessage, event: JsonElement): AgentRunDisplayMessage {
    val obj = event.jsonObject
    return when (obj.string("type")) {
        "progress" -> message.withCompletedActive().copy(
            status = "thinking",
            steps = message.withCompletedActive().steps + AgentRunStep(stepId(), "progress", "过程输出", "completed", obj.string("text"))
        )
        "thinking" -> message.withNewActive("thinking", "思考中", "thinking", obj.string("text"))
        "tool_use" -> {
            val status = obj.string("status")
            if (status == "started") {
                message.withNewActive("tool", "正在调用 ${obj.string("name") ?: "工具"}", "tool", toolName = obj.string("name"))
            } else {
                message.withCompletedActive(failed = status == "failed")
            }
        }
        "tool_result" -> message.withCompletedActive(failed = obj["isError"]?.jsonPrimitive?.booleanOrNull == true)
        "todo" -> {
            val todos = obj["items"]?.let(::decodeTodos).orEmpty()
            val withoutOld = message.steps.filterNot { it.type == "todo" }
            message.copy(steps = withoutOld + AgentRunStep(stepId(), "todo", "计划 · ${todos.count { it.status == "completed" }}/${todos.size}", "completed", todos = todos))
        }
        "plan" -> {
            val withoutOld = message.steps.filterNot { it.type == "plan" }
            message.copy(steps = withoutOld + AgentRunStep(stepId(), "plan", "计划", "completed", text = obj.string("plan")))
        }
        "text" -> {
            val nextText = listOf(message.text, obj.string("text").orEmpty()).filter { it.isNotBlank() }.joinToString("\n\n")
            message.withCompletedActive().copy(status = "responding", text = nextText)
        }
        "turn_completed" -> {
            val finalText = obj.string("finalText")
            message.withCompletedActive().copy(status = "responding", text = finalText ?: message.text)
        }
        "error" -> message.withCompletedActive(failed = true).copy(status = "error")
        "done" -> {
            val finalText = obj.string("finalText")
            message.withCompletedActive(failed = obj["success"]?.jsonPrimitive?.booleanOrNull == false)
                .copy(status = if (obj["success"]?.jsonPrimitive?.booleanOrNull == false) "error" else "done", text = finalText ?: message.text)
        }
        else -> message
    }
}

fun reduceRuntime(runtime: RuntimeState, event: JsonElement): RuntimeState {
    val obj = event.jsonObject
    return when (obj.string("type")) {
        "progress" -> runtime.copy(phase = "thinking", label = "Working", detail = obj.string("text"))
        "thinking" -> runtime.copy(phase = "thinking", label = "Thinking", detail = obj.string("text"))
        "tool_use" -> runtime.copy(phase = "tool", label = "Using tool", toolName = obj.string("name"))
        "tool_result" -> runtime.copy(phase = "tool", label = "Tool result")
        "todo" -> runtime.copy(todos = obj["items"]?.let(::decodeTodos).orEmpty())
        "text" -> runtime.copy(phase = "streaming", label = "Responding", detail = null)
        "error" -> runtime.copy(phase = "error", label = "Error", detail = obj.string("message"))
        "done" -> runtime.copy(phase = if (obj["success"]?.jsonPrimitive?.booleanOrNull == false) "error" else "done", label = if (obj["success"]?.jsonPrimitive?.booleanOrNull == false) "Error" else "Done", detail = obj.string("finalText"))
        else -> runtime
    }
}

fun groupRuntimeLabel(event: JsonElement): String? {
    val obj = event.jsonObject
    return when (obj.string("type")) {
        "orchestrator_plan" -> "已生成任务计划"
        "task_status" -> "任务进度：${obj.string("status") ?: "更新"}"
        "member_turn_event" -> "成员执行中"
        "blackboard_update" -> obj["update"]?.jsonObject?.string("summary") ?: "黑板已更新"
        "orchestrator_report" -> "汇总中"
        "done" -> if (obj["success"]?.jsonPrimitive?.booleanOrNull == false) "Error" else "Done"
        else -> null
    }
}

fun validateAgentForm(
    name: String,
    color: String,
    providerId: String,
    model: String,
    workingDirectory: String
): String? {
    if (name.trim().isBlank()) return "请输入名称"
    if (!Regex("^#[0-9a-fA-F]{6}$").matches(color.trim())) return "请输入合法颜色，如 #3370ff"
    if (providerId.isBlank()) return "请选择 PlatformProvider"
    if (model.isBlank()) return "请选择模型"
    if (workingDirectory.isBlank()) return "请选择服务端工作目录"
    return null
}

fun validateGroupForm(title: String, memberIds: Set<String>, providerId: String, model: String, projectName: String): String? {
    if (title.trim().isBlank()) return "请填写群标题"
    if (memberIds.isEmpty()) return "请至少选择一个成员 Agent"
    if (providerId.isBlank()) return "请为 Orchestrator 选择 Provider"
    if (model.isBlank()) return "请为 Orchestrator 选择模型"
    if (projectName.trim().isBlank()) return "请填写项目名"
    return null
}

private fun AgentRunDisplayMessage.withCompletedActive(failed: Boolean = false): AgentRunDisplayMessage =
    copy(steps = steps.map { if (it.status == "active") it.copy(status = if (failed) "failed" else "completed") else it })

private fun AgentRunDisplayMessage.withNewActive(
    type: String,
    label: String,
    status: String,
    text: String? = null,
    toolName: String? = null
): AgentRunDisplayMessage {
    val base = withCompletedActive()
    return base.copy(
        status = status,
        steps = base.steps + AgentRunStep(stepId(), type, label, "active", text = text, toolName = toolName)
    )
}

private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

private fun stepId(): String = "step-${System.nanoTime()}"

private fun nowIsoText(): String = java.time.Instant.now().toString()

private fun decodeTodos(element: JsonElement): List<AgentTodoItem> =
    runCatching {
        Json.decodeFromJsonElement(ListSerializer(AgentTodoItem.serializer()), element)
    }.getOrDefault(emptyList())
