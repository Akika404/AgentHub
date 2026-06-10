import type { AgentChatMessageView, AgentRunStepView } from '../dto/agent-message-view.dto.js'
import type { AgentMessage } from '../entities/agent-message.entity.js'
import type { AgentMessageStep } from '../entities/agent-message-step.entity.js'

export function toAgentRunStepView(step: AgentMessageStep): AgentRunStepView {
    return {
        id: step.id,
        seq: step.seq,
        type: step.type,
        text: step.text,
        toolName: step.toolName,
        toolUseId: step.toolUseId,
        toolStatus: step.toolStatus,
        input: step.input,
        output: step.output,
        isError: step.isError,
        todos: step.todos
    }
}

export function toAgentChatMessageView(
    message: AgentMessage,
    steps: AgentMessageStep[] = []
): AgentChatMessageView {
    const view: AgentChatMessageView = {
        id: message.id,
        chatId: message.sessionId,
        agentId: message.agentId,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        pinned: message.pinned === true
    }
    if (steps.length > 0) {
        view.steps = steps.map(toAgentRunStepView)
    }
    if (message.artifacts && message.artifacts.length > 0) {
        view.artifacts = message.artifacts
    }
    if (message.deployManifest) {
        view.deployManifest = message.deployManifest
    }
    if (message.replyTo) {
        view.replyTo = message.replyTo
    }
    return view
}
