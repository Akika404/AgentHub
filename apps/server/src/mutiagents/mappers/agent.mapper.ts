import type { AgentAdapterConfig } from '../adapter/index.js'
import { getCapabilities } from '../adapter/index.js'
import type { Agent } from '../entities/agent.entity.js'
import type { AgentSession } from '../entities/agent-session.entity.js'
import type { AgentReasoningEffort, AgentView } from '../dto/agent-view.dto.js'
import type { AgentChatView } from '../dto/agent-chat-view.dto.js'

type ReasoningEffort = AgentAdapterConfig['reasoningEffort']

/**
 * (Agent + chat session) -> AgentAdapterConfig.
 *
 * apiKey / baseUrl are injected by AgentManager from PlatformProvider. Agent
 * owns the provider/model/systemPrompt/tool policy; each chat owns cwd, private
 * home, skills and MCP.
 */
export function agentToConfig(
    agent: Agent,
    session: AgentSession,
    apiKey: string,
    baseUrl: string,
    idHint?: string
): AgentAdapterConfig {
    return {
        id: idHint,
        model: agent.model,
        agentHomeDirectory: session.sessionHomeDirectory,
        workingDirectory: session.workingDirectory,
        apiKey,
        baseUrl,
        reasoningEffort: (agent.reasoningEffort as ReasoningEffort) ?? undefined,
        systemPrompt: agent.systemPrompt ?? undefined,
        skills: session.skills ?? undefined,
        mcpServers: session.mcpServers ?? undefined,
        allowedTools: agent.allowedTools ?? undefined,
        permissionMode: agent.permissionMode ?? undefined
    }
}

export function toAgentView(agent: Agent): AgentView {
    return {
        id: agent.id,
        name: agent.name,
        avatar: agent.avatar,
        color: agent.color,
        vendor: agent.vendor,
        platformProviderId: agent.platformProviderId,
        model: agent.model,
        agentHomeDirectory: agent.agentHomeDirectory,
        workingDirectory: agent.workingDirectory,
        capabilities: getCapabilities(agent.vendor),
        createdAt: agent.createdAt.toISOString(),
        updatedAt: agent.updatedAt.toISOString(),
        systemPrompt: agent.systemPrompt,
        skills: agent.skills,
        mcpServers: agent.mcpServers,
        allowedTools: agent.allowedTools,
        permissionMode: agent.permissionMode,
        reasoningEffort: (agent.reasoningEffort as AgentReasoningEffort | null) ?? null
    }
}

export function toAgentChatView(
    session: AgentSession,
    agent: Agent,
    activeTurnId: string | null
): AgentChatView {
    return {
        id: session.id,
        agentId: session.agentId,
        agent: {
            id: agent.id,
            name: agent.name,
            avatar: agent.avatar,
            color: agent.color,
            vendor: agent.vendor,
            model: agent.model,
            capabilities: getCapabilities(agent.vendor)
        },
        title: session.title,
        workingDirectory: session.workingDirectory,
        sessionHomeDirectory: session.sessionHomeDirectory,
        skills: session.skills,
        mcpServers: session.mcpServers,
        status: session.status,
        hasLiveSession: session.sdkSessionId != null,
        activeTurnId,
        lastTurnAt: session.lastTurnAt ? session.lastTurnAt.toISOString() : null,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString()
    }
}
