/**
 * 统一 Agent 适配层 —— 类型定义
 *
 * 设计目标：把 Claude Agent SDK 和 OpenAI Codex SDK 各自的事件流，
 * 归一成同一套 AgentEvent，供 AgentHub 的群聊编排层消费。
 */

export type AgentVendor = 'claude' | 'codex'

/** 资源用量。两边字段不完全一致，做合并；缺失字段保持 undefined。 */
export interface AgentUsage {
    inputTokens?: number
    outputTokens?: number
    cachedInputTokens?: number
    reasoningTokens?: number
    totalCostUSD?: number
}

/** Agent 当前会话的工具调用状态 */
export type ToolCallStatus = 'started' | 'completed' | 'failed'

/** Todo 条目状态。Claude 原生三态，Codex 只有 pending/completed 两态 */
export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

/** 一条 Todo 条目 */
export interface AgentTodoItem {
    text: string
    status: AgentTodoStatus
}

/**
 * 统一事件。所有事件都带 `vendor` 字段，便于调试时区分来源。
 *
 * 事件语义：
 * - session_started: 会话建立，首次拿到 sessionId
 * - turn_started: 一轮（一次 prompt）开始
 * - progress: 助手对当前动作的过程播报，展示在运行过程里
 * - text: 助手最终输出的自然语言文本
 * - thinking: 推理/思考过程（codex reasoning / claude thinking block）
 * - tool_use: 工具调用（含 shell、编辑文件、MCP 等）
 * - tool_result: 工具返回结果
 * - todo: TODO 列表变化
 * - turn_completed: 一轮结束
 * - error: 非致命错误
 * - done: 整个 send() 调用结束（无论成功失败）。流的最后一条。
 */
export type AgentEvent =
    | { type: 'session_started'; vendor: AgentVendor; sessionId: string }
    | { type: 'turn_started'; vendor: AgentVendor }
    | { type: 'progress'; vendor: AgentVendor; text: string; itemId?: string }
    | { type: 'text'; vendor: AgentVendor; text: string; itemId?: string }
    | { type: 'thinking'; vendor: AgentVendor; text: string; itemId?: string }
    | {
          type: 'tool_use'
          vendor: AgentVendor
          id: string
          name: string
          input: unknown
          status: ToolCallStatus
      }
    | {
          type: 'tool_result'
          vendor: AgentVendor
          toolUseId: string
          output: unknown
          isError?: boolean
      }
    | { type: 'todo'; vendor: AgentVendor; items: AgentTodoItem[] }
    | { type: 'plan'; vendor: AgentVendor; plan: string }
    | {
          type: 'turn_completed'
          vendor: AgentVendor
          finalText?: string
          usage?: AgentUsage
      }
    | { type: 'error'; vendor: AgentVendor; message: string; fatal?: boolean }
    | {
          type: 'done'
          vendor: AgentVendor
          success: boolean
          finalText?: string
          usage?: AgentUsage
      }

/**
 * 权限模式。取自 Claude SDK 的 PermissionMode 取值集，作为统一接口。
 * Codex 端只能近似映射（never ≈ bypassPermissions），本期默认 bypass。
 */
export type AgentPermissionMode =
    | 'default'
    | 'acceptEdits'
    | 'bypassPermissions'
    | 'plan'
    | 'dontAsk'
    | 'auto'

/** 构造一个 Agent 时的通用配置 */
export interface AgentAdapterConfig {
    /** AgentHub 内部的唯一标识，例如 "claude-bob"。仅做日志/调试用 */
    id?: string
    /** 模型名 */
    model: string
    /** Agent 私有持久目录；Claude 用于 CLAUDE_CONFIG_DIR，Codex 用于 CODEX_HOME */
    agentHomeDirectory: string
    /** 工作目录（agent 实际操作文件系统的根） */
    workingDirectory: string
    /** API key */
    apiKey: string
    /** 自定义 base url（用于 Anthropic / OpenAI 兼容网关） */
    baseUrl?: string
    /** 附加环境变量。会与 process.env 合并 */
    env?: Record<string, string | undefined>
    /** 推理 effort。两边都有，但取值集不完全相同，由各 adapter 自行映射 */
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

    /**
     * 系统提示词。Claude 走 options.systemPrompt；Codex 走
     * CodexOptions.config.instructions（由 core 映射成 base_instructions）。
     */
    systemPrompt?: string
    /**
     * 预加载的 skills。Claude 走 options.skills（"all" 或名称数组）；
     * Codex 通过工作目录下的 .codex/skills 发现。skill 文件本身需由上层
     * 从 Agent Home 同步到当前会话的 workingDirectory。
     */
    skills?: 'all' | string[]
    /**
     * MCP 服务器配置。形状对齐 Claude SDK 的 Record<string, McpServerConfig>；
     * 用 unknown value 以免把 SDK 类型泄漏到统一接口，由各 adapter 自行收窄。
     */
    mcpServers?: Record<string, unknown>
    /** 工具白名单。不传时各 adapter 用各自的默认集合 */
    allowedTools?: string[]
    /** 权限模式。不传时各 adapter 默认 bypassPermissions（自动化全开） */
    permissionMode?: AgentPermissionMode
}

/**
 * adapter 能力描述符。用于向上层（AgentManager / 前端）声明厂商差异，
 * 避免假装两家能力对齐。创建 Agent 时上层据此校验配置是否被支持。
 */
export interface AgentCapabilities {
    supportsSystemPrompt: boolean
    supportsSkills: boolean
    supportsMcp: boolean
    /** 是否支持按外部 sessionId 跨进程恢复（两家当前都支持） */
    supportsResumeById: boolean
}

/** 发送消息时的可选项 */
export interface SendOptions {
    /** 取消信号 */
    signal?: AbortSignal
}

/**
 * 统一 Agent 适配器接口。
 *
 * 语义：
 * - 一个 adapter 实例对应一个会话（多轮对话上下文连续）
 * - `send()` 发送一条用户消息，返回事件流的 async iterable
 * - 流以一条 `done` 事件结束
 * - 同一个 adapter 上不允许并发调用 `send()`（调用方要等流结束）
 */
export interface AgentAdapter {
    readonly vendor: AgentVendor
    readonly id: string
    /** 当前会话 id（首次 send 之后才有值） */
    readonly sessionId: string | null
    /** 发送一条用户消息 */
    send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent>
    /**
     * 注入一个已有的 SDK 会话 id，使下一次 send() 续接该会话（跨进程恢复）。
     * 必须在首次 send() 之前调用。Claude 走 options.resume，Codex 走 resumeThread。
     */
    resumeWith(sdkSessionId: string): void
    /** 返回该 vendor 的能力描述符（厂商不对称声明） */
    capabilities(): AgentCapabilities
}
