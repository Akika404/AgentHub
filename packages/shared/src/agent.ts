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

export interface AgentChatMessageView {
  id: string
  chatId: string
  agentId: string
  role: AgentChatMessageRole
  text: string
  createdAt: string
}

/** Vendor capability matrix (asymmetric: codex lacks systemPrompt/skills/mcp). */
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
    supportsSystemPrompt: false,
    supportsSkills: false,
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
  lastTurnAt: string | null
  createdAt: string
  updatedAt: string
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
  /** Local skill directories to copy into this Agent's private `.claude/skills`. */
  skillSourceDirectories?: string[]
  skills?: 'all' | string[]
  mcpServers?: Record<string, unknown>
  allowedTools?: string[]
  permissionMode?: AgentPermissionMode
  reasoningEffort?: AgentReasoningEffort
}

/**
 * Create single-Agent chat input. systemPrompt is intentionally absent; chats
 * inherit the Agent-level system prompt.
 */
export interface CreateAgentChatPayload {
  agentId: string
  title?: string
  workingDirectory: string
  /** Local skill directories copied into this chat's private home. */
  skillSourceDirectories?: string[]
  /** MCP servers shallow-merged with the Agent-level config. */
  mcpServers?: Record<string, unknown>
}
