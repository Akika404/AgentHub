import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentExecutionMode } from '@agenthub/shared'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'

export interface AgentChatAgentSummary {
    id: string
    name: string
    avatar: string | null
    color: string
    vendor: AgentVendor
    /** 执行位置；客户端据此决定 diff/commit 走服务器还是本机。 */
    executionMode: AgentExecutionMode
    model: string
    capabilities: AgentCapabilities
}

export interface AgentChatView {
    id: string
    agentId: string
    agent: AgentChatAgentSummary
    title: string | null
    workingDirectory: string
    sessionHomeDirectory: string
    skills: 'all' | string[] | null
    mcpServers: Record<string, unknown> | null
    status: AgentSessionStatus
    isPinned: boolean
    archivedAt: string | null
    hasLiveSession: boolean
    activeTurnId: string | null
    lastTurnAt: string | null
    createdAt: string
    updatedAt: string
}
