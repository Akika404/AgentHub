/**
 * Platform-provider module contract.
 * Mirrors `apps/server/src/platform-provider/dto/*`.
 */

export type ProviderType = 'openai-chat-completions' | 'openai-responses' | 'anthropic'

/** All provider types, for select options / validation. */
export const PROVIDER_TYPES: ProviderType[] = [
  'openai-chat-completions',
  'openai-responses',
  'anthropic'
]

/** Human-facing labels for each protocol type. */
export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  'openai-chat-completions': 'OpenAI (Chat Completions)',
  'openai-responses': 'OpenAI (Responses)',
  anthropic: 'Anthropic'
}

/** Outward provider view: apiKey returned only as a mask, never plaintext. */
export interface PlatformProviderView {
  id: string
  /** display name, unique per user */
  platformName: string
  type: ProviderType
  baseUrl: string
  /** model name list */
  modelList: string[]
  /** masked api key, e.g. `sk-****wl7g`; null when no key. Never plaintext. */
  apiKeyMasked: string | null
  /** ISO8601 */
  createdAt: string
  /** ISO8601 */
  updatedAt: string
}

/** Connection test result. */
export interface ProviderTestResult {
  ok: boolean
  /** probe latency in ms */
  latencyMs: number
  /** number of models pulled when connected */
  modelCount?: number
  /** failure reason; absent when ok */
  message?: string
}

/** Create input (modelList optional, defaults to empty array server-side). */
export interface CreateProviderPayload {
  platformName: string
  type: ProviderType
  baseUrl: string
  apiKey: string
  modelList?: string[]
}

/**
 * Partial update. All fields optional; omit `apiKey` to keep the existing key,
 * pass it to overwrite. `modelList` replaces wholesale when provided.
 */
export interface UpdateProviderPayload {
  platformName?: string
  type?: ProviderType
  baseUrl?: string
  apiKey?: string
  modelList?: string[]
}
