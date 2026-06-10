import { LOCAL_DEFAULT_MODEL, type AgentExecutionMode, type AgentVendor } from '@agenthub/shared'

export function vendorLabel(vendor: AgentVendor): string {
  return vendor === 'claude' ? 'Claude Code' : 'Codex'
}

export function agentModelLabel(agent: {
  executionMode?: AgentExecutionMode
  model: string
}): string {
  if (agent.executionMode === 'local' && agent.model === LOCAL_DEFAULT_MODEL) {
    return '本地默认配置'
  }
  return agent.model
}
