import type { AgentAdapterConfig } from '../adapter/index.js'
import { getCapabilities } from '../adapter/index.js'
import type { Agent } from '../entities/agent.entity.js'
import type { AgentSession } from '../entities/agent-session.entity.js'
import type { AgentReasoningEffort, AgentView } from '../dto/agent-view.dto.js'

type ReasoningEffort = AgentAdapterConfig['reasoningEffort']

/**
 * Agent → AgentAdapterConfig。
 *
 * apiKey / baseUrl 不存在 Agent 上，由调用方（Manager）从所引用 Provider 的
 * resolveRuntimeConfig 注入。null 列归一为 undefined，以匹配 adapter config 的 optional 语义。
 */
export function agentToConfig(
    agent: Agent,
    apiKey: string,
    baseUrl: string,
    idHint?: string
): AgentAdapterConfig {
    return {
        id: idHint,
        model: agent.model,
        agentHomeDirectory: agent.agentHomeDirectory,
        workingDirectory: agent.workingDirectory,
        apiKey,
        baseUrl,
        reasoningEffort: (agent.reasoningEffort as ReasoningEffort) ?? undefined,
        systemPrompt: agent.systemPrompt ?? undefined,
        skills: agent.skills ?? undefined,
        mcpServers: agent.mcpServers ?? undefined,
        allowedTools: agent.allowedTools ?? undefined,
        permissionMode: agent.permissionMode ?? undefined
    }
}

/**
 * (agent, 单聊会话?) → 对外视图。
 *
 * session 为 null（尚未开过会话）时 status 记为 `none`、无 lastTurnAt / live session。
 */
export function toAgentView(agent: Agent, session: AgentSession | null): AgentView {
    return {
        id: agent.id,
        name: agent.name,
        vendor: agent.vendor,
        platformProviderId: agent.platformProviderId,
        model: agent.model,
        agentHomeDirectory: agent.agentHomeDirectory,
        workingDirectory: agent.workingDirectory,
        capabilities: getCapabilities(agent.vendor),
        status: session ? session.status : 'none',
        hasLiveSession: session?.sdkSessionId != null,
        lastTurnAt: session?.lastTurnAt ? session.lastTurnAt.toISOString() : null,
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
