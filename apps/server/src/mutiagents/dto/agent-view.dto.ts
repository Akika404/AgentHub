import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'

/**
 * 对外返回的 Agent 视图（会话 + 档案的投影）。
 * 与实体分离：不暴露内部列结构，也不携带敏感字段。
 */
export interface AgentView {
    /** 会话 id（客户端用它对话） */
    sessionId: string
    specId: string
    vendor: AgentVendor
    model: string
    workingDirectory: string
    status: AgentSessionStatus
    /** 该 vendor 的能力描述（厂商不对称声明） */
    capabilities: AgentCapabilities
    /** 是否有进行中的底层会话（sdkSessionId 非空） */
    hasLiveSession: boolean
    lastTurnAt: string | null
    createdAt: string
}

/** 创建成功后的返回 */
export interface CreateAgentResult {
    sessionId: string
    specId: string
    vendor: AgentVendor
    capabilities: AgentCapabilities
}
