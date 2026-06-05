export * from './types.js'
export { ClaudeAdapter } from './claude.js'
export { CodexAdapter } from './codex.js'
export { getCapabilities, CLAUDE_CAPABILITIES, CODEX_CAPABILITIES } from './capabilities.js'

import { ClaudeAdapter } from './claude.js'
import { CodexAdapter } from './codex.js'
import type { AgentAdapter, AgentAdapterConfig, AgentVendor } from './types.js'

/** 工厂：按 vendor 名拉一个 adapter 出来 */
export function createAgent(vendor: AgentVendor, config: AgentAdapterConfig): AgentAdapter {
    if (vendor === 'claude') return new ClaudeAdapter(config)
    if (vendor === 'codex') return new CodexAdapter(config)
    throw new Error(`Unknown agent vendor: ${vendor}`)
}
