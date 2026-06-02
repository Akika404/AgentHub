import type { AgentMessageRole } from '../entities/agent-message.entity.js'

export interface AgentChatMessageView {
    id: string
    chatId: string
    agentId: string
    role: AgentMessageRole
    text: string
    createdAt: string
}
