import type { ChatMessage, SenderInfo } from '../api'

export interface AgentRunStep {
  id: string
  type: 'thinking' | 'tool'
  label: string
  status: 'active' | 'completed' | 'failed'
}

export interface AgentRunMessage {
  id: string
  chatId: string
  kind: 'agent-run'
  timestamp: string
  pinned?: boolean
  sender: SenderInfo
  status: 'thinking' | 'tool' | 'responding' | 'done' | 'error'
  steps: AgentRunStep[]
  text: string
}

export type ChatDisplayMessage = ChatMessage | AgentRunMessage

export function isAgentRunMessage(message: ChatDisplayMessage): message is AgentRunMessage {
  return message.kind === 'agent-run'
}

export function isChatMessage(message: ChatDisplayMessage): message is ChatMessage {
  return !isAgentRunMessage(message)
}
