/**
 * Multi-agent module contract.
 * Mirrors `apps/server/src/multiagents/dto/*` and `adapter/types.ts`.
 */

import type { MessageReplyRef } from './chat.js'
import type { BlackboardArtifact } from './blackboard.js'
import type { DeployManifest } from './deployment.js'

export type AgentVendor = 'claude' | 'codex'

/** Internal stored value for local agents that should use the CLI's configured default model. */
export const LOCAL_DEFAULT_MODEL = '__agenthub_local_default__'

/**
 * 执行位置。
 * - `server`（默认）：Agent 在服务器进程内通过 SDK 子进程执行，操作服务器文件系统。
 *   现有的全部行为。
 * - `local`：Agent 通过反向通道转发到用户桌面端，由本机已安装的 Claude Code / Codex
 *   执行，操作用户本机文件系统，并使用用户本机的登录态（ambient auth）。
 *   仅单聊（scope=user）支持；群聊成员仍强制 server。
 */
export type AgentExecutionMode = 'server' | 'local'

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

export type AgentChatMessageRole = 'user' | 'agent' | 'system'

/** 运行步骤类型。tool 行把 tool_use 与 tool_result 按 toolUseId 合并为一条 */
export type AgentMessageStepType = 'thinking' | 'progress' | 'tool' | 'todo' | 'plan'

/** 一条运行步骤的对外视图。镜像 `apps/server/src/multiagents/dto/agent-message-view.dto.ts` */
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
  /** when true the message is pinned within the chat and injected into future context */
  pinned: boolean
  /** 该消息产出过程中的有序运行步骤；仅 agent 消息可能非空 */
  steps?: AgentRunStepView[]
  /**
   * 本轮 agent run 产出/改动的文件,从 turn 起止的 workspace diff 增量推导,
   * 作为快照随消息持久化,供 agent-run 气泡内联预览卡片渲染(对齐群聊
   * `GroupTextMessageView.artifacts`)。仅 agent 消息可能非空。
   */
  artifacts?: BlackboardArtifact[]
  /**
   * 本轮产出可呈现交付物时附带的 static 预览清单(如 `index.html`),供渲染层在
   * 该 agent 消息后插入一张预览卡片。单聊仅支持 `static`,不做 service 部署。
   */
  deployManifest?: DeployManifest
  /** when present, this user message is a reply that quotes another message */
  replyTo?: MessageReplyRef
}

/** Update a single-Agent chat message. Omitted fields are left unchanged. */
export interface UpdateAgentChatMessagePayload {
  pinned?: boolean
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
 * `apps/server/src/multiagents/adapter/capabilities.ts` (single source of truth);
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
  type: import('./provider.js').ProviderType
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
  /** short human-authored capability summary for routing/group orchestration */
  capabilitySummary: string | null
  vendor: AgentVendor
  /** 执行位置；local 表示接入用户本机的 Claude Code / Codex。默认 server。 */
  executionMode: AgentExecutionMode
  /**
   * referenced platform_provider.id。server 模式必填；local 模式为 null
   * （用本机 CLI 自己的登录态，不引用服务器 Provider）。
   */
  platformProviderId: string | null
  /** server 模式为实际模型；local 模式可为 LOCAL_DEFAULT_MODEL，表示使用本机 CLI 默认配置。 */
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
  /** 执行位置；客户端据此决定 diff/commit 走服务器还是本机。 */
  executionMode: AgentExecutionMode
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
  /** Cross-device list pin state. */
  isPinned: boolean
  /** null means the chat is writable; non-null means archived/read-only. */
  archivedAt: string | null
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
 * `platformProviderId`; server-mode `model` must belong to that provider's modelList.
 *
 * 当 `executionMode === 'local'` 时：`platformProviderId` 省略（用本机 CLI 登录态），
 * `model` 可省略，省略时使用本机 CLI 的默认模型配置；`workingDirectory`
 * 是用户**本机**的绝对路径（不校验服务器 workspace 根），
 * `skillSourceDirectories` 不适用（本机 skills 由用户本机配置发现）。
 */
export interface CreateAgentPayload {
  name: string
  avatar?: string | null
  color?: string
  capabilitySummary: string
  vendor: AgentVendor
  /** 执行位置；省略时默认 server（保持既有行为）。 */
  executionMode?: AgentExecutionMode
  /** server 模式必填；local 模式省略。 */
  platformProviderId?: string
  model?: string
  /** Optional Agent-private home; omitted values are allocated under the user's agent_home. */
  agentHomeDirectory?: string
  /**
   * Agent default workspace。server 模式须在当前用户的 agent_workspace 下；
   * local 模式是用户本机的绝对路径。
   */
  workingDirectory: string
  systemPrompt?: string
  /** Server-side skill directories under the current user's skills root. */
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
  capabilitySummary?: string | null
  vendor?: AgentVendor
  platformProviderId?: string
  model?: string
  /** Agent default workspace; must be under the current user's agent_workspace. */
  workingDirectory?: string
  systemPrompt?: string | null
  /** Server-side skill directories under the current user's skills root. */
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
  /** Must be under the current user's agent_workspace; omit to allocate chat-<sessionId>. */
  workingDirectory?: string
  /** Server-side skill directories under the current user's skills root. */
  skillSourceDirectories?: string[]
  /** MCP servers shallow-merged with the Agent-level config. */
  mcpServers?: Record<string, unknown>
}

/** Update single-Agent chat list metadata. Omitted fields are left unchanged. */
export interface UpdateAgentChatPayload {
  isPinned?: boolean
  /** true archives the chat, false restores it to writable. */
  archived?: boolean
}
