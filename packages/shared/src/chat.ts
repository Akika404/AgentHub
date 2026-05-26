/**
 * API contract types shared between the renderer UI and whichever service
 * (mock or real) fulfills it.
 */

export type ChatKind = 'group' | 'agent' | 'user' | 'team'

export interface ChatAvatar {
  kind: 'initials' | 'icon'
  /** initials text (when kind = 'initials') */
  text?: string
  /** material-symbols icon name (when kind = 'icon') */
  icon?: string
  /** tailwind background color class for the icon variant */
  tone?: 'primary' | 'neutral'
}

export interface ChatSummary {
  id: string
  title: string
  preview: string
  kind: ChatKind
  avatar: ChatAvatar
  unread?: number
  active?: boolean
}

export interface SenderInfo {
  id: string
  name: string
  role: 'user' | 'orchestrator' | 'agent' | 'system'
  /** material-symbols icon (for agent/orchestrator avatars) */
  icon?: string
  /** short initials (for user avatars) */
  initials?: string
  /** color theme for the bubble avatar */
  accent?: 'primary' | 'violet' | 'green' | 'neutral'
}

export interface TaskItem {
  id: string
  title: string
  status: 'in-progress' | 'pending' | 'done'
}

export interface OptionItem {
  id: string
  label: string
  selected?: boolean
}

interface BaseMessage {
  id: string
  chatId: string
  timestamp: string
}

export interface SystemMessage extends BaseMessage {
  kind: 'system'
  text: string
}

export interface TextMessage extends BaseMessage {
  kind: 'text'
  sender: SenderInfo
  text: string
}

export interface TaskListMessage extends BaseMessage {
  kind: 'task-list'
  sender: SenderInfo
  heading: string
  tasks: TaskItem[]
}

export interface OptionsMessage extends BaseMessage {
  kind: 'options'
  sender: SenderInfo
  text: string
  options: OptionItem[]
  placeholder?: string
}

export type ChatMessage = SystemMessage | TextMessage | TaskListMessage | OptionsMessage

export interface ChatDetail {
  id: string
  title: string
  status: string
  agentCount: number
}

export type NetworkNodeStatus = 'active' | 'working' | 'idle'

export interface NetworkNode {
  id: string
  name: string
  status: NetworkNodeStatus
  /** ID of the parent node; null for the root */
  parentId: string | null
}

export interface AgentHubApi {
  listChats(): Promise<ChatSummary[]>
  getChatDetail(chatId: string): Promise<ChatDetail>
  listMessages(chatId: string): Promise<ChatMessage[]>
  getNetwork(chatId: string): Promise<NetworkNode[]>
  sendMessage(chatId: string, text: string): Promise<TextMessage>
}
