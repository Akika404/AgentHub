import type { AgentAdapterConfig } from '../adapter/index.js'
import { getCapabilities } from '../adapter/index.js'
import type { AgentSpec } from '../entities/agent-spec.entity.js'
import type { AgentSession } from '../entities/agent-session.entity.js'
import type { AgentView } from '../dto/agent-view.dto.js'

type ReasoningEffort = AgentAdapterConfig['reasoningEffort']

/**
 * AgentSpec → AgentAdapterConfig。
 *
 * apiKey 不存库，由调用方（Manager）从 ConfigService 注入。null 列归一为 undefined，
 * 以匹配 adapter config 的 optional 语义。
 */
export function specToConfig(
  spec: AgentSpec,
  apiKey: string,
  idHint?: string,
): AgentAdapterConfig {
  return {
    id: idHint,
    model: spec.model,
    workingDirectory: spec.workingDirectory,
    apiKey,
    baseUrl: spec.baseUrl ?? undefined,
    reasoningEffort: (spec.reasoningEffort as ReasoningEffort) ?? undefined,
    systemPrompt: spec.systemPrompt ?? undefined,
    skills: spec.skills ?? undefined,
    mcpServers: spec.mcpServers ?? undefined,
    allowedTools: spec.allowedTools ?? undefined,
    permissionMode: spec.permissionMode ?? undefined,
  }
}

/** (session, spec) → 对外视图 */
export function toAgentView(session: AgentSession, spec: AgentSpec): AgentView {
  return {
    sessionId: session.id,
    specId: spec.id,
    vendor: session.vendor,
    model: spec.model,
    workingDirectory: spec.workingDirectory,
    status: session.status,
    capabilities: getCapabilities(session.vendor),
    hasLiveSession: session.sdkSessionId != null,
    lastTurnAt: session.lastTurnAt ? session.lastTurnAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
  }
}
