import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'

export interface AgentChatAgentSummary {
    id: string
    name: string
    avatar: string | null
    color: string
    vendor: AgentVendor
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
