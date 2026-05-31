import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'

/** Agent 视图里的运行时状态：在会话状态之上多一个 `none`（尚未开过任何会话）。 */
export type AgentRuntimeStatus = AgentSessionStatus | 'none'

/**
 * 对外返回的 Agent 视图（以 Agent 配置为主体，附带单聊会话的运行时状态）。
 * 与实体分离：不暴露内部列结构，也不携带 apiKey 等敏感字段。
 */
export interface AgentView {
    /** Agent id（客户端用它对话 / 管理） */
    id: string
    /** 展示名 */
    name: string
    vendor: AgentVendor
    /** 引用的模型平台 id */
    platformProviderId: string
    model: string
    workingDirectory: string
    /** 该 vendor 的能力描述（厂商不对称声明） */
    capabilities: AgentCapabilities
    /** 单聊会话状态；尚未开过会话为 `none` */
    status: AgentRuntimeStatus
    /** 是否有进行中的底层会话（sdkSessionId 非空） */
    hasLiveSession: boolean
    /** 最近一轮对话时间，ISO8601；从未对话为 null */
    lastTurnAt: string | null
    createdAt: string
    updatedAt: string
}
