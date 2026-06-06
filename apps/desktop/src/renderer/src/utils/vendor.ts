import type { AgentVendor } from '@agenthub/shared'

export function vendorLabel(vendor: AgentVendor): string {
  return vendor === 'claude' ? 'Claude Code' : 'Codex'
}
