import type {
  AgentTodoItem,
  BlackboardArtifact,
  ChatMessage,
  DeployManifest,
  GroupAttachmentView,
  SenderInfo
} from '../api'

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
  attachments?: GroupAttachmentView[]
  sender: SenderInfo
  status: 'thinking' | 'tool' | 'responding' | 'done' | 'error'
  steps: AgentRunStep[]
  text: string
}

/** 部署卡片（渲染层）：群聊总结后展示可预览/可运行的交付物。 */
export interface DeployMessage {
  id: string
  chatId: string
  kind: 'deploy'
  timestamp: string
  pinned?: boolean
  attachments?: GroupAttachmentView[]
  sender: SenderInfo
  manifest: DeployManifest
  artifacts: BlackboardArtifact[]
}

export type ChatDisplayMessage = ChatMessage | AgentRunMessage | DeployMessage

export function isAgentRunMessage(message: ChatDisplayMessage): message is AgentRunMessage {
  return message.kind === 'agent-run'
}

export function isDeployMessage(message: ChatDisplayMessage): message is DeployMessage {
  return message.kind === 'deploy'
}

export function isChatMessage(message: ChatDisplayMessage): message is ChatMessage {
  return !isAgentRunMessage(message) && !isDeployMessage(message)
}
