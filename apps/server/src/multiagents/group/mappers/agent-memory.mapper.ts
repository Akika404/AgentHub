import type { AgentMemoryItem } from '@agenthub/shared'
import type { AgentMemoryItemEntity } from '../memory/entities/agent-memory-item.entity.js'

export function toAgentMemoryView(e: AgentMemoryItemEntity): AgentMemoryItem {
    return {
        id: e.id,
        agentId: e.agentId,
        content: e.content,
        type: e.type,
        scope: { project: e.scopeProject, module: e.scopeModule },
        source: { type: e.sourceType, ref: e.sourceRef },
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        lastUsedAt: e.lastUsedAt ? e.lastUsedAt.toISOString() : null
    }
}
