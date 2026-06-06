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
  /** hex color for initials avatars */
  color?: string
  /** data URL of a user-uploaded avatar image; overrides icon/initials */
  avatarDataUrl?: string
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
  /** hex color for generated initials avatars */
  color?: string
  /** data URL of a user-uploaded avatar image; overrides icon/initials */
  avatarDataUrl?: string
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
  /** when true the message is pinned within the chat */
  pinned?: boolean
}

export interface SystemMessage extends BaseMessage {
  kind: 'system'
  text: string
}

export interface MessageReplyRef {
  /** id of the message being replied to */
  messageId: string
  /** display name of the original sender */
  senderName: string
  /** short excerpt of the original message content */
  excerpt: string
}

export interface TextMessage extends BaseMessage {
  kind: 'text'
  sender: SenderInfo
  text: string
  /** when present, this message is a reply that quotes another message */
  replyTo?: MessageReplyRef
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
  /** when true the user has already chosen — options become read-only */
  answered?: boolean
  /** id of the option that was picked (when answered) */
  answeredOptionId?: string
}

export type ChatMessage = SystemMessage | TextMessage | TaskListMessage | OptionsMessage

/**
 * Group chat presentation_log message (multi-speaker). This is the persisted,
 * outward shape for `GET /group-chats/:id/messages`. It unifies the existing
 * card kinds (text / task-list / options / system) and adds the sender's role +
 * member agent id so the renderer can map each message to its own bubble.
 */
export type GroupSenderRole = 'user' | 'orchestrator' | 'agent' | 'system'

interface GroupMessageBase {
  id: string
  groupChatId: string
  senderRole: GroupSenderRole
  /** member Agent id when senderRole === 'agent'; null for user/orchestrator/system */
  senderAgentId: string | null
  createdAt: string
}

export interface GroupTextMessageView extends GroupMessageBase {
  kind: 'text'
  text: string
}

export interface GroupSystemMessageView extends GroupMessageBase {
  kind: 'system'
  text: string
}

export interface GroupTaskListMessageView extends GroupMessageBase {
  kind: 'task-list'
  heading: string
  tasks: TaskItem[]
}

export interface GroupOptionsMessageView extends GroupMessageBase {
  kind: 'options'
  text: string
  options: OptionItem[]
  answered?: boolean
  answeredOptionId?: string
}

export type GroupMessageView =
  | GroupTextMessageView
  | GroupSystemMessageView
  | GroupTaskListMessageView
  | GroupOptionsMessageView

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
  sendMessage(chatId: string, text: string, replyTo?: MessageReplyRef): Promise<TextMessage>
  getCurrentUser(): Promise<CurrentUser>
  updateCurrentUserAvatar(avatarDataUrl: string | null): Promise<CurrentUser>
}

/** Profile of the logged-in user. Drives "me" avatars across the UI. */
export interface CurrentUser {
  id: string
  name: string
  initials: string
  accent: NonNullable<SenderInfo['accent']>
  /** data URL of the user-uploaded avatar; null/undefined falls back to initials */
  avatarDataUrl?: string | null
}
