package com.aichallenge.agenthub

import com.aichallenge.agenthub.data.AgentCapabilities
import com.aichallenge.agenthub.data.AgentChatAgentSummary
import com.aichallenge.agenthub.data.AgentChatView
import com.aichallenge.agenthub.data.AgentRunDisplayMessage
import com.aichallenge.agenthub.data.AgentRunStep
import com.aichallenge.agenthub.data.AgentRunStepView
import com.aichallenge.agenthub.data.AgentTodoItem
import com.aichallenge.agenthub.data.ApiResponse
import com.aichallenge.agenthub.data.CreateAgentPayload
import com.aichallenge.agenthub.data.DeletedResult
import com.aichallenge.agenthub.data.GroupMemberView
import com.aichallenge.agenthub.data.GroupMessageView
import com.aichallenge.agenthub.data.RuntimeState
import com.aichallenge.agenthub.data.SenderInfo
import com.aichallenge.agenthub.data.deriveChatItems
import com.aichallenge.agenthub.data.groupMessageToDisplay
import com.aichallenge.agenthub.data.reduceAgentRun
import com.aichallenge.agenthub.data.reduceRuntime
import com.aichallenge.agenthub.data.validateAgentForm
import com.aichallenge.agenthub.data.validateGroupForm
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.parseToJsonElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReducersTest {
    @Test
    fun sortChatsPinnedBeforeLatest() {
        val olderPinned = agentChat("a", pinned = true, updatedAt = "2026-01-01T00:00:00.000Z")
        val newer = agentChat("b", pinned = false, updatedAt = "2026-02-01T00:00:00.000Z")

        val items = deriveChatItems(listOf(newer, olderPinned), emptyList(), emptySet(), "")

        assertEquals("agent:a", items.first().key)
    }

    @Test
    fun filtersChatsBySearchText() {
        val chat = agentChat("a", pinned = false, updatedAt = "2026-01-01T00:00:00.000Z")

        val matching = deriveChatItems(listOf(chat), emptyList(), emptySet(), "Agent a")
        val missing = deriveChatItems(listOf(chat), emptyList(), emptySet(), "not here")

        assertEquals(1, matching.size)
        assertTrue(missing.isEmpty())
    }

    @Test
    fun validateAgentRequiresDirectory() {
        val error = validateAgentForm("Agent", "#3370ff", "provider", "model", "")

        assertEquals("请选择服务端工作目录", error)
    }

    @Test
    fun validateGroupRequiresMember() {
        val error = validateGroupForm("Group", emptySet(), "provider", "model", "Project")

        assertEquals("请至少选择一个成员 Agent", error)
    }

    @Test
    fun reduceAgentRunAppendsTextAndFinishes() {
        val start = AgentRunDisplayMessage(
            id = "run",
            chatId = "chat",
            timestamp = "2026-01-01T00:00:00.000Z",
            sender = SenderInfo("agent", "Agent", "agent"),
            status = "thinking",
            steps = listOf(AgentRunStep("step", "thinking", "thinking", "active")),
            text = ""
        )

        val textEvent = Json.parseToJsonElement("""{"type":"text","vendor":"codex","text":"hello"}""")
        val doneEvent = Json.parseToJsonElement("""{"type":"done","vendor":"codex","success":true}""")

        val afterText = reduceAgentRun(start, textEvent)
        val afterDone = reduceAgentRun(afterText, doneEvent)

        assertEquals("hello", afterText.text)
        assertEquals("done", afterDone.status)
        assertTrue(afterDone.steps.all { it.status != "active" })
    }

    @Test
    fun reduceRuntimeStoresTodos() {
        val event = Json.parseToJsonElement(
            """{"type":"todo","vendor":"codex","items":[{"text":"ship","status":"in_progress"}]}"""
        )

        val runtime = reduceRuntime(RuntimeState(), event)

        assertEquals(listOf(AgentTodoItem("ship", "in_progress")), runtime.todos)
    }

    @Test
    fun groupAgentMessageWithStepsRendersAsRunMessage() {
        val view = GroupMessageView(
            id = "message-1",
            groupChatId = "group-1",
            senderRole = "agent",
            senderAgentId = "agent-1",
            createdAt = "2026-01-01T00:00:00.000Z",
            kind = "text",
            text = "完成了移动端同步",
            steps = listOf(
                AgentRunStepView(
                    id = "step-1",
                    seq = 0,
                    type = "thinking",
                    text = "分析最近提交"
                )
            )
        )
        val member = GroupMemberView(
            agentId = "agent-1",
            name = "Android",
            color = "#3370ff",
            vendor = "codex",
            capabilities = AgentCapabilities()
        )

        val message = groupMessageToDisplay(view, listOf(member), "me")

        assertTrue(message is AgentRunDisplayMessage)
        val run = message as AgentRunDisplayMessage
        assertEquals("done", run.status)
        assertEquals("Android", run.sender.name)
        assertEquals("完成了移动端同步", run.text)
        assertEquals("思考中", run.steps.single().label)
    }

    @Test
    fun envelopeParsingReadsSuccessPayload() {
        val json = Json { ignoreUnknownKeys = true }
        val envelope = json.decodeFromString(
            ApiResponse.serializer(DeletedResult.serializer()),
            """{"code":0,"message":"ok","data":{"deleted":true},"timestamp":"2026-01-01T00:00:00.000Z"}"""
        )

        assertEquals(0, envelope.code)
        assertEquals(true, envelope.data?.deleted)
    }

    @Test
    fun createAgentPayloadOmitsDefaultNullsAndKeepsSkills() {
        val json = Json { encodeDefaults = false }
        val payload = CreateAgentPayload(
            name = "Builder",
            color = "#3370ff",
            vendor = "codex",
            platformProviderId = "provider-1",
            model = "gpt-5",
            workingDirectory = "/workspace/project",
            skills = JsonPrimitive("all")
        )

        val encoded = json.encodeToString(CreateAgentPayload.serializer(), payload)

        assertTrue(encoded.contains(""""workingDirectory":"/workspace/project""""))
        assertTrue(encoded.contains(""""skills":"all""""))
        assertFalse(encoded.contains("agentHomeDirectory"))
    }

    private fun agentChat(id: String, pinned: Boolean, updatedAt: String): AgentChatView =
        AgentChatView(
            id = id,
            agentId = "agent-$id",
            agent = AgentChatAgentSummary(
                id = "agent-$id",
                name = "Agent $id",
                color = "#3370ff",
                vendor = "codex",
                model = "gpt-5",
                capabilities = AgentCapabilities()
            ),
            workingDirectory = "/workspace/$id",
            sessionHomeDirectory = "/home/$id",
            status = "active",
            isPinned = pinned,
            archivedAt = null,
            hasLiveSession = false,
            activeTurnId = null,
            lastTurnAt = null,
            createdAt = updatedAt,
            updatedAt = updatedAt
        )
}
