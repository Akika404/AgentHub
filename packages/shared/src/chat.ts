/**
 * API contract types shared between the renderer UI and whichever service
 * (mock or real) fulfills it.
 */

import type { AgentRunStepView } from './agent.js'
import type { DeployManifest } from './deployment.js'
import type { BlackboardArtifact } from './blackboard.js'

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
  status: 'in-progress' | 'pending' | 'done' | 'failed' | 'blocked'
}

export interface OptionItem {
  id: string
  label: string
  selected?: boolean
}

/** 成员提问卡片：单个可选项（镜像 AskUserQuestion 的 option）。 */
export interface AgentQuestionOption {
  id: string
  label: string
  /** 选项的补充说明（次要文字） */
  description?: string
}

/** 成员提问卡片：单个问题（镜像 AskUserQuestion 的 question）。 */
export interface AgentQuestion {
  id: string
  question: string
  /** 简短标签 */
  header?: string
  /** 可选项；为空表示该题纯自由输入 */
  options: AgentQuestionOption[]
  /** 允许多选 */
  multiSelect?: boolean
  /** 允许「其它/补充」自由输入 */
  allowText?: boolean
}

interface BaseMessage {
  id: string
  chatId: string
  timestamp: string
  /** when true the message is pinned within the chat */
  pinned?: boolean
  attachments?: GroupAttachmentView[]
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

/** File attached to a group chat message and made available in the workspace. */
export interface GroupAttachmentView {
  id: string
  groupChatId: string
  originalName: string
  mimeType: string
  size: number
  /** workspace-relative path; null until the attachment is consumed by a group run */
  workspacePath: string | null
  createdAt: string
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

/**
 * 成员提问卡片（渲染层）：成员挂起任务向用户提问时展示，用户逐题作答后拼接成一句回复自动发送。
 */
export interface AgentQuestionMessage extends BaseMessage {
  kind: 'agent-question'
  sender: SenderInfo
  questions: AgentQuestion[]
  /** 一句话摘要（预览/回退） */
  summary: string
  /** 已作答后置灰只读 */
  answered?: boolean
  /** 已作答时用户提交的拼接回复 */
  answerText?: string
}

export type ChatMessage =
  | SystemMessage
  | TextMessage
  | TaskListMessage
  | OptionsMessage
  | AgentQuestionMessage

/**
 * Group chat presentation_log message (multi-speaker). This is the persisted,
 * outward shape for `GET /group-chats/:id/messages`. It unifies the existing
 * card kinds (text / task-list / options / system) and adds the sender's role +
 * member agent id so the renderer can map each message to its own bubble.
 * Agent text messages may also include their persisted run steps.
 */
export type GroupSenderRole = 'user' | 'orchestrator' | 'agent' | 'system'

interface GroupMessageBase {
  id: string
  groupChatId: string
  senderRole: GroupSenderRole
  /** member Agent id when senderRole === 'agent'; null for user/orchestrator/system */
  senderAgentId: string | null
  createdAt: string
  /** when true the message is pinned within the group and injected into future context */
  pinned: boolean
  attachments?: GroupAttachmentView[]
}

export interface GroupTextMessageView extends GroupMessageBase {
  kind: 'text'
  text: string
  /** member Agent run steps when this text came from a group member turn */
  steps?: AgentRunStepView[]
  /**
   * Artifacts this member turn produced/updated, surfaced as inline preview cards
   * in the agent-run bubble. Persisted as a snapshot so cards survive history reload.
   */
  artifacts?: BlackboardArtifact[]
  /** when present, this message is a reply that quotes another message */
  replyTo?: MessageReplyRef
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

export interface GroupAgentQuestionView extends GroupMessageBase {
  kind: 'agent-question'
  /** 关联的挂起任务 id（用户回复时据此恢复 + 标记已作答） */
  taskId: string
  questions: AgentQuestion[]
  /** 一句话摘要（预览/回退） */
  summary: string
  answered?: boolean
  answerText?: string
}

/**
 * 部署卡片（渲染层）：群聊 run 在 Orchestrator 总结后产出可呈现交付物时展示。
 * `static` 模式点「预览」直接在产物抽屉打开 `entryPath`；`service` 模式展示
 * 声明的启动命令，用户确认后由服务端起 dev server，再在部署抽屉里 iframe 显示。
 */
export interface GroupDeployMessageView extends GroupMessageBase {
  kind: 'deploy'
  manifest: DeployManifest
  /** 本轮可部署/预览的产物（卡片据此列出可点项） */
  artifacts: BlackboardArtifact[]
}

export type GroupMessageView =
  | GroupTextMessageView
  | GroupSystemMessageView
  | GroupTaskListMessageView
  | GroupOptionsMessageView
  | GroupAgentQuestionView
  | GroupDeployMessageView

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
