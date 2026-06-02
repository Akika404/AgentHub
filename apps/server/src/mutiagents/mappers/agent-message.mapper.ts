import type { AgentChatMessageView } from '../dto/agent-message-view.dto.js'
import type { AgentMessage } from '../entities/agent-message.entity.js'

export function toAgentChatMessageView(message: AgentMessage): AgentChatMessageView {
    return {
        id: message.id,
        chatId: message.sessionId,
        agentId: message.agentId,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt.toISOString()
    }
}
