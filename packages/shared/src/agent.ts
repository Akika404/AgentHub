/**
 * Multi-agent module contract.
 * Mirrors `apps/server/src/mutiagents/dto/*` and `adapter/types.ts`.
 */

export type AgentVendor = 'claude' | 'codex'

/** Single-chat session runtime status; `none` = no session opened yet. */
export type AgentRuntimeStatus = 'active' | 'suspended' | 'cleared' | 'none'

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
 * lets the create form gate fields without constructing an adapter.
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

/** vendor ↔ provider type compatibility: claude↔anthropic; codex↔openai-*. */
export function isVendorProviderCompatible(
  vendor: AgentVendor,
  type: import('./provider').ProviderType
): boolean {
  return vendor === 'claude'
    ? type === 'anthropic'
    : type === 'openai-responses' || type === 'openai-chat-completions'
}

/**
 * Outward agent view (config + single-chat runtime status projection).
 *
 * NOTE: `systemPrompt` / `skills` / `mcpServers` / `allowedTools` /
 * `permissionMode` / `reasoningEffort` depend on the backend extending
 * `agent-view.dto.ts` to expose them (the create DTO already accepts them, but
 * the current view omits them). Until then these come back as null/undefined
 * and the UI shows empty placeholders. This shared type IS the contract.
 */
export interface AgentView {
  /** Agent id (client uses it to converse / manage) */
  id: string
  /** display name */
  name: string
  vendor: AgentVendor
  /** referenced platform_provider.id */
  platformProviderId: string
  model: string
  workingDirectory: string
  /** vendor capability description */
  capabilities: AgentCapabilities
  /** single-chat session status; `none` before any session */
  status: AgentRuntimeStatus
  /** whether an underlying session exists (sdkSessionId non-null) */
  hasLiveSession: boolean
  /** last turn time, ISO8601; null if never conversed */
  lastTurnAt: string | null
  createdAt: string
  updatedAt: string

  // --- pending backend AgentView extension (see note above) ---
  systemPrompt?: string | null
  skills?: 'all' | string[] | null
  mcpServers?: Record<string, unknown> | null
  allowedTools?: string[] | null
  permissionMode?: AgentPermissionMode | null
  reasoningEffort?: AgentReasoningEffort | null
}

/**
 * Create input. baseUrl/apiKey are not passed here — referenced via
 * `platformProviderId`; `model` must belong to that provider's modelList.
 */
export interface CreateAgentPayload {
  name: string
  vendor: AgentVendor
  platformProviderId: string
  model: string
  workingDirectory: string
  systemPrompt?: string
  skills?: 'all' | string[]
  mcpServers?: Record<string, unknown>
  allowedTools?: string[]
  permissionMode?: AgentPermissionMode
  reasoningEffort?: AgentReasoningEffort
}
