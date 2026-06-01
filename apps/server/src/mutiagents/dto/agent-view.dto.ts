import type { AgentCapabilities, AgentPermissionMode, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'

/** Agent 视图里的运行时状态：在会话状态之上多一个 `none`（尚未开过任何会话）。 */
export type AgentRuntimeStatus = AgentSessionStatus | 'none'

/** 推理 effort 取值集（与 create-agent.dto / adapter config 对齐）。 */
export type AgentReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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
    /** Agent 私有持久目录；单聊时默认也作为工作目录 */
    agentHomeDirectory: string
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

    /**
     * 详情面板展示用的配置字段。是否真正生效取决于 vendor 能力（见 capabilities）；
     * 未配置时为 null。codex 不支持 systemPrompt / skills / mcp，对应字段恒为 null。
     */
    systemPrompt: string | null
    /** "all" 或技能名数组；未配置为 null */
    skills: 'all' | string[] | null
    /** MCP 服务器配置（Claude 形状的 Record<string, McpServerConfig>）；未配置为 null */
    mcpServers: Record<string, unknown> | null
    /** 工具白名单；未配置为 null（adapter 用各自默认集合） */
    allowedTools: string[] | null
    /** 权限模式；未配置为 null */
    permissionMode: AgentPermissionMode | null
    /** 推理 effort；未配置为 null */
    reasoningEffort: AgentReasoningEffort | null
}
