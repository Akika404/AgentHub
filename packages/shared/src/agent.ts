/**
 * Multi-agent module contract.
 * Mirrors `apps/server/src/mutiagents/dto/*` and `adapter/types.ts`.
 */

export type AgentVendor = 'claude' | 'codex'

export type AgentChatStatus = 'active' | 'suspended' | 'cleared'

export interface AgentUsage {
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  reasoningTokens?: number
  totalCostUSD?: number
}

export type ToolCallStatus = 'started' | 'completed' | 'failed'
export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed'

export interface AgentTodoItem {
  text: string
  status: AgentTodoStatus
}

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

export type AgentChatMessageRole = 'user' | 'agent' | 'system'

/** 运行步骤类型。tool 行把 tool_use 与 tool_result 按 toolUseId 合并为一条 */
export type AgentMessageStepType = 'thinking' | 'progress' | 'tool' | 'todo'

/** 一条运行步骤的对外视图。镜像 `apps/server/src/mutiagents/dto/agent-message-view.dto.ts` */
export interface AgentRunStepView {
  id: string
  seq: number
  type: AgentMessageStepType
  /** thinking/progress 文本；其余类型为 null */
  text: string | null
  toolName: string | null
  toolUseId: string | null
  toolStatus: ToolCallStatus | null
  input: unknown
  output: unknown
  isError: boolean | null
  todos: AgentTodoItem[] | null
}

export interface AgentChatMessageView {
  id: string
  chatId: string
  agentId: string
  role: AgentChatMessageRole
  text: string
  createdAt: string
  /** 该消息产出过程中的有序运行步骤；仅 agent 消息可能非空 */
  steps?: AgentRunStepView[]
}

/** Vendor capability matrix (asymmetric: codex lacks mcp). */
export interface AgentCapabilities {
  supportsSystemPrompt: boolean
  supportsSkills: boolean
  supportsMcp: boolean
  /** can resume across processes by external sessionId */
  supportsResumeById: boolean
}

export type AgentPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export type AgentReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Per-vendor capability matrix. Mirrors
 * `apps/server/src/mutiagents/adapter/capabilities.ts` (single source of truth);
 * lets forms gate fields without constructing an adapter.
 */
export const VENDOR_CAPABILITIES: Record<AgentVendor, AgentCapabilities> = {
  claude: {
    supportsSystemPrompt: true,
    supportsSkills: true,
    supportsMcp: true,
    supportsResumeById: true
  },
  codex: {
    supportsSystemPrompt: true,
    supportsSkills: true,
    supportsMcp: false,
    supportsResumeById: true
  }
}

/** vendor <-> provider type compatibility: claude<->anthropic; codex<->openai-*. */
export function isVendorProviderCompatible(
  vendor: AgentVendor,
  type: import('./provider').ProviderType
): boolean {
  return vendor === 'claude'
    ? type === 'anthropic'
    : type === 'openai-responses' || type === 'openai-chat-completions'
}

/**
 * Outward agent view. It is pure Agent configuration and intentionally carries
 * no chat/session runtime state.
 */
export interface AgentView {
  /** Agent id (client uses it to manage or start chats) */
  id: string
  /** display name */
  name: string
  /** avatar URL / compact data URL (<= 256 KiB); null falls back to initials */
  avatar: string | null
  /** hex color used for the fallback initials avatar and color marker */
  color: string
  vendor: AgentVendor
  /** referenced platform_provider.id */
  platformProviderId: string
  model: string
  /** Agent-private persisted home directory. */
  agentHomeDirectory: string
  /** Agent default working directory; a chat can override it. */
  workingDirectory: string
  /** vendor capability description */
  capabilities: AgentCapabilities
  createdAt: string
  updatedAt: string

  // --- detail-panel config fields (null when unset / unsupported) ---
  systemPrompt: string | null
  skills: 'all' | string[] | null
  mcpServers: Record<string, unknown> | null
  allowedTools: string[] | null
  permissionMode: AgentPermissionMode | null
  reasoningEffort: AgentReasoningEffort | null
}

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
  /** Chat/session id. Use this id for messages, converse, clear and delete. */
  id: string
  agentId: string
  agent: AgentChatAgentSummary
  /** User-supplied title; null means the client should render an automatic title. */
  title: string | null
  workingDirectory: string
  sessionHomeDirectory: string
  /** Effective skills after merging Agent config with this chat's imported skills. */
  skills: 'all' | string[] | null
  /** Effective MCP config after shallow merge; chat keys override Agent keys. */
  mcpServers: Record<string, unknown> | null
  status: AgentChatStatus
  hasLiveSession: boolean
  /**
   * Id of the turn currently running for this chat, or null when idle. A client
   * opening the chat subscribes to this turn's event stream to watch live
   * progress produced by any device.
   */
  activeTurnId: string | null
  lastTurnAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Result of starting a converse turn. The turn runs server-side detached from
 * the request; subscribe to `/agent-chats/:chatId/turns/:turnId/events` to watch
 * it (replay + live tail), from this or any other device. Starting a new turn
 * while `activeTurnId` is set returns AGENT_BUSY; subscribe to the active turn
 * to watch it instead.
 */
export interface StartTurnResult {
  turnId: string
}

/**
 * Create Agent input. baseUrl/apiKey are not passed here: referenced via
 * `platformProviderId`; `model` must belong to that provider's modelList.
 */
export interface CreateAgentPayload {
  name: string
  avatar?: string | null
  color?: string
  vendor: AgentVendor
  platformProviderId: string
  model: string
  agentHomeDirectory?: string
  workingDirectory: string
  systemPrompt?: string
  /** Local skill directories to copy into this Agent's vendor skills directory. */
  skillSourceDirectories?: string[]
  skills?: 'all' | string[]
  mcpServers?: Record<string, unknown>
  allowedTools?: string[]
  permissionMode?: AgentPermissionMode
  reasoningEffort?: AgentReasoningEffort
}

/**
 * Update Agent input. Omitted fields are left unchanged; nullable config fields
 * can be sent as null to clear them.
 */
export interface UpdateAgentPayload {
  name?: string
  avatar?: string | null
  color?: string
  vendor?: AgentVendor
  platformProviderId?: string
  model?: string
  workingDirectory?: string
  systemPrompt?: string | null
  /** Local skill directories to copy into this Agent's vendor skills directory. */
  skillSourceDirectories?: string[]
  skills?: 'all' | string[] | null
  mcpServers?: Record<string, unknown> | null
  allowedTools?: string[] | null
  permissionMode?: AgentPermissionMode | null
  reasoningEffort?: AgentReasoningEffort | null
}

/**
 * Create single-Agent chat input. systemPrompt is intentionally absent; chats
 * inherit the Agent-level system prompt.
 */
export interface CreateAgentChatPayload {
  agentId: string
  title?: string
  /** Omit to let the server create AgentHome/TaskN. */
  workingDirectory?: string
  /** Local skill directories copied into this chat's working directory vendor skills folder. */
  skillSourceDirectories?: string[]
  /** MCP servers shallow-merged with the Agent-level config. */
  mcpServers?: Record<string, unknown>
}
