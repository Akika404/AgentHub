import type { AgentTodoItem, ChatMessage, SenderInfo } from '../api'

export interface AgentRunStep {
  id: string
  type: 'thinking' | 'progress' | 'tool' | 'todo' | 'plan'
  label: string
  status: 'active' | 'completed' | 'failed'
  /** thinking/progress 文本（历史复原时带上，供后续详情查看） */
  text?: string
  /** tool 步骤的工具名 / 调用 id / 完整入参与返回（历史复原时带上） */
  toolName?: string
  toolUseId?: string
  input?: unknown
  output?: unknown
  isError?: boolean
  /** todo 步骤的任务清单快照（计划卡片渲染用） */
  todos?: AgentTodoItem[]
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
