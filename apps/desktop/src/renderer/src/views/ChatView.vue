<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  AgentChatMessageView,
  AgentChatView,
  AgentEvent,
  AgentRunStepView,
  AgentTodoItem,
  AgentView,
  BlackboardArtifact,
  BlackboardTaskNode,
  BlackboardView,
  ChatDetail,
  ChatSummary,
  GroupChatView,
  GroupMemberView,
  GroupRunEvent,
  MessageReplyRef,
  OptionItem,
  OptionsMessage,
  SenderInfo,
  TextMessage
} from '../api'
import { ApiError, agentApi } from '../api'
import { agentChatApi, type AgentConverseHandlers, type AgentConverseStream } from '../api/agents'
import { groupChatApi, type GroupRunStream } from '../api/group-chats'
import { authState } from '../stores/auth'
import { groupMessageToDisplay, type GroupSenderMeta } from '../utils/groupMessage'
import { vendorLabel } from '../utils/vendor'
import {
  isAgentRunMessage,
  type AgentRunMessage,
  type AgentRunStep,
  type ChatDisplayMessage
} from '../types/chatDisplay'
import { agentInitials } from '../utils/avatar'
import { formatTime } from '../utils/format'
import ChatList from '../components/ChatList.vue'
import ChatHeader from '../components/ChatHeader.vue'
import MessageList from '../components/MessageList.vue'
import MessageInput from '../components/MessageInput.vue'
import RightInspector from '../components/RightInspector.vue'
import PinnedBar from '../components/PinnedBar.vue'
import AgentChatCreateDialog from '../components/AgentChatCreateDialog.vue'
import GroupChatCreateDialog from '../components/GroupChatCreateDialog.vue'
import GroupDetailPanel from '../components/GroupDetailPanel.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ArtifactPreviewDrawer from '../components/ArtifactPreviewDrawer.vue'

type RuntimePhase = 'idle' | 'thinking' | 'tool' | 'streaming' | 'error' | 'done'
type SessionKind = 'agent' | 'group'
type ChatListItem = ChatSummary & {
  pinned: boolean
  running?: boolean
  updatedAt?: string
  groupMembers?: GroupMemberView[]
}

const PINNED_CHAT_IDS_STORAGE_KEY = 'agenthub:pinned-chat-ids'
const CHAT_LIST_WIDTH_STORAGE_KEY = 'agenthub:chat-list-width'
const INSPECTOR_WIDTH_STORAGE_KEY = 'agenthub:right-inspector-width'
const GLOBAL_SIDEBAR_WIDTH = 68
const MIN_MAIN_WIDTH = 420
const CHAT_LIST_MIN_WIDTH = 220
const CHAT_LIST_DEFAULT_WIDTH = 280
const CHAT_LIST_MAX_WIDTH = 420
const INSPECTOR_MIN_WIDTH = 260
const INSPECTOR_DEFAULT_WIDTH = 300
const INSPECTOR_MAX_WIDTH = 520

const agentSessionKey = (id: string): string => `agent:${id}`
const groupSessionKey = (id: string): string => `group:${id}`

function sessionKind(key: string): SessionKind | null {
  if (key.startsWith('agent:')) return 'agent'
  if (key.startsWith('group:')) return 'group'
  return null
}

function sessionRawId(key: string): string {
  return key.slice(key.indexOf(':') + 1)
}

interface AgentRuntimeState {
  phase: RuntimePhase
  label: string
  detail?: string
  toolName?: string
  todos: AgentTodoItem[]
}

const agentChats = ref<AgentChatView[]>([])
const groupChats = ref<GroupChatView[]>([])
const agents = ref<AgentView[]>([])
const activeSessionKey = ref<string | null>(null)
const messages = ref<ChatDisplayMessage[]>([])
const activeGroupBlackboard = ref<BlackboardView | null>(null)
const previewArtifact = ref<BlackboardArtifact | null>(null)
const groupBlackboards = new Map<string, BlackboardView | null>()
const chatListWidth = ref(readStoredWidth(CHAT_LIST_WIDTH_STORAGE_KEY, CHAT_LIST_DEFAULT_WIDTH))
const inspectorWidth = ref(readStoredWidth(INSPECTOR_WIDTH_STORAGE_KEY, INSPECTOR_DEFAULT_WIDTH))
const resizingPane = ref<'chat-list' | 'inspector' | null>(null)
const messageCache = new Map<string, ChatDisplayMessage[]>()
const turnStreams = new Map<string, AgentConverseStream>()
const groupStreams = new Map<string, GroupRunStream>()
const runMessageIds = new Map<string, string>()
const runMessageSessionKeys = new Map<string, string>()
const groupRunTasks = new Map<string, BlackboardTaskNode[]>()
const notifiedTurnIds = new Set<string>()
const notifiedGroupRunIds = new Set<string>()
let activeLoadId = 0
let dragStartX = 0
let dragStartWidth = 0
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const chatsLoading = ref(false)
const agentsLoading = ref(false)
const agentsError = ref<string | null>(null)
const messagesLoading = ref(false)
const runningChatIds = ref<Set<string>>(new Set())
const createChatOpen = ref(false)
const createGroupOpen = ref(false)
const pinnedChatIds = ref<Set<string>>(readPinnedChatIds())
const deleteChatTarget = ref<ChatListItem | null>(null)
const deleteChatConfirmOpen = ref(false)
const deletingChat = ref(false)
const deleteChatError = ref<string | null>(null)

const pendingReply = ref<MessageReplyRef | null>(null)
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const runtime = ref<AgentRuntimeState>(idleRuntime())

const activeChat = computed(() =>
  activeSessionKey.value
    ? (agentChats.value.find((chat) => agentSessionKey(chat.id) === activeSessionKey.value) ?? null)
    : null
)
const activeGroup = computed(() =>
  activeSessionKey.value
    ? (groupChats.value.find((group) => groupSessionKey(group.id) === activeSessionKey.value) ??
      null)
    : null
)

const streaming = computed(() =>
  activeSessionKey.value ? runningChatIds.value.has(activeSessionKey.value) : false
)

const chats = computed<ChatListItem[]>(() => {
  const agentItems = agentChats.value.map((chat, index) => {
    const key = agentSessionKey(chat.id)
    const updatedAt = chat.lastTurnAt ?? chat.updatedAt
    return {
      item: {
        id: key,
        title: titleForChat(chat),
        preview: previewForChat(chat),
        kind: 'agent' as const,
        avatar: {
          kind: 'initials' as const,
          text: agentInitials(chat.agent.name),
          color: chat.agent.color,
          avatarDataUrl: chat.agent.avatar ?? undefined,
          tone: chat.status === 'active' ? ('primary' as const) : ('neutral' as const)
        },
        active: key === activeSessionKey.value,
        pinned: pinnedChatIds.value.has(key),
        running: isChatRunning(key),
        updatedAt
      },
      index,
      updatedAt
    }
  })

  const groupItems = groupChats.value.map((group, index) => {
    const key = groupSessionKey(group.id)
    const updatedAt = group.updatedAt
    return {
      item: {
        id: key,
        title: group.title,
        preview: previewForGroup(group),
        kind: 'group' as const,
        avatar: { kind: 'icon' as const, icon: 'groups', tone: 'primary' as const },
        active: key === activeSessionKey.value,
        pinned: pinnedChatIds.value.has(key),
        running: isChatRunning(key),
        updatedAt,
        groupMembers: group.members
      },
      index: agentChats.value.length + index,
      updatedAt
    }
  })

  return [...agentItems, ...groupItems]
    .sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1
      const aTime = Date.parse(a.updatedAt)
      const bTime = Date.parse(b.updatedAt)
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime
      }
      return a.index - b.index
    })
    .map(({ item }) => item)
})

const deleteChatMessage = computed(() => {
  const chat = deleteChatTarget.value
  if (!chat) return ''
  const base = `确认删除聊天「${chat.title}」？聊天记录会一并删除。`
  return deleteChatError.value ? `${base}\n${deleteChatError.value}` : base
})

const chatDetail = computed<ChatDetail | null>(() => {
  const chat = activeChat.value
  if (chat) {
    return {
      id: chat.id,
      title: titleForChat(chat),
      status: runtime.value.phase === 'error' ? 'Error' : statusLabel(chat.status),
      agentCount: 1
    }
  }

  const group = activeGroup.value
  if (!group) return null
  return {
    id: group.id,
    title: group.title,
    status: runtime.value.phase === 'error' ? 'Error' : groupStatusLabel(group),
    agentCount: group.members.length
  }
})

function idleRuntime(): AgentRuntimeState {
  return { phase: 'idle', label: 'Idle', todos: [] }
}

function statusLabel(status: AgentChatView['status']): string {
  const labels: Record<AgentChatView['status'], string> = {
    active: 'Active',
    suspended: 'Suspended',
    cleared: 'Cleared'
  }
  return labels[status]
}

function groupStatusLabel(group: GroupChatView): string {
  if (isGroupRunning(group.id)) return 'Running'
  return group.status === 'active' ? 'Active' : 'Archived'
}

function titleForChat(chat: AgentChatView): string {
  const custom = chat.title?.trim()
  if (custom) return custom
  return `${chat.agent.name} ${formatTime(chat.createdAt)}`
}

function previewForChat(chat: AgentChatView): string {
  const key = agentSessionKey(chat.id)
  if (isChatRunning(key)) {
    if (key === activeSessionKey.value) return runtime.value.label
    return '正在运行'
  }
  if (chat.lastTurnAt) return `最近 ${formatTime(chat.lastTurnAt)}`
  return `${vendorLabel(chat.agent.vendor)} / ${chat.agent.model}`
}

function previewForGroup(group: GroupChatView): string {
  const key = groupSessionKey(group.id)
  if (isChatRunning(key)) {
    if (key === activeSessionKey.value) return runtime.value.label
    return '群聊运行中'
  }
  const goal = group.projectMeta.goal?.trim()
  if (goal) return goal
  return `${group.members.length} 成员 · ${group.projectMeta.name}`
}

function isChatRunning(chatId: string): boolean {
  return runningChatIds.value.has(chatId)
}

function isGroupRunning(groupId: string): boolean {
  return isChatRunning(groupSessionKey(groupId))
}

function setChatRunning(chatId: string, running: boolean): void {
  const next = new Set(runningChatIds.value)
  if (running) next.add(chatId)
  else next.delete(chatId)
  runningChatIds.value = next
}

function markChatActiveTurn(chatId: string, turnId: string | null): void {
  agentChats.value = agentChats.value.map((chat) =>
    chat.id === chatId ? { ...chat, activeTurnId: turnId } : chat
  )
}

function reconcileRunningIndicators(): void {
  const next = new Set<string>([...turnStreams.keys(), ...groupStreams.keys()])
  for (const chat of agentChats.value) {
    if (chat.activeTurnId) next.add(agentSessionKey(chat.id))
  }
  for (const group of groupChats.value) {
    if (group.activeRunId) next.add(groupSessionKey(group.id))
  }
  runningChatIds.value = next
}

function readPinnedChatIds(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_CHAT_IDS_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function writePinnedChatIds(ids: Set<string>): void {
  localStorage.setItem(PINNED_CHAT_IDS_STORAGE_KEY, JSON.stringify([...ids]))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function readStoredWidth(key: string, fallback: number): number {
  const raw = localStorage.getItem(key)
  const value = raw ? Number(raw) : Number.NaN
  return Number.isFinite(value) ? value : fallback
}

function mainAwareMaxWidth(kind: 'chat-list' | 'inspector'): number {
  const otherSideWidth = kind === 'chat-list' ? inspectorWidth.value : chatListWidth.value
  return window.innerWidth - GLOBAL_SIDEBAR_WIDTH - MIN_MAIN_WIDTH - otherSideWidth
}

function normalizePaneWidths(): void {
  chatListWidth.value = clamp(
    chatListWidth.value,
    CHAT_LIST_MIN_WIDTH,
    Math.min(CHAT_LIST_MAX_WIDTH, mainAwareMaxWidth('chat-list'))
  )
  inspectorWidth.value = clamp(
    inspectorWidth.value,
    INSPECTOR_MIN_WIDTH,
    Math.min(INSPECTOR_MAX_WIDTH, mainAwareMaxWidth('inspector'))
  )
}

function persistPaneWidth(kind: 'chat-list' | 'inspector'): void {
  const key = kind === 'chat-list' ? CHAT_LIST_WIDTH_STORAGE_KEY : INSPECTOR_WIDTH_STORAGE_KEY
  const width = kind === 'chat-list' ? chatListWidth.value : inspectorWidth.value
  localStorage.setItem(key, String(width))
}

function startPaneResize(kind: 'chat-list' | 'inspector', event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  resizingPane.value = kind
  dragStartX = event.clientX
  dragStartWidth = kind === 'chat-list' ? chatListWidth.value : inspectorWidth.value
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', onPaneResizeMove)
  window.addEventListener('pointerup', stopPaneResize, { once: true })
}

function onPaneResizeMove(event: PointerEvent): void {
  const kind = resizingPane.value
  if (!kind) return

  const delta = event.clientX - dragStartX
  if (kind === 'chat-list') {
    chatListWidth.value = clamp(
      dragStartWidth + delta,
      CHAT_LIST_MIN_WIDTH,
      Math.min(CHAT_LIST_MAX_WIDTH, mainAwareMaxWidth('chat-list'))
    )
    return
  }

  inspectorWidth.value = clamp(
    dragStartWidth - delta,
    INSPECTOR_MIN_WIDTH,
    Math.min(INSPECTOR_MAX_WIDTH, mainAwareMaxWidth('inspector'))
  )
}

function stopPaneResize(): void {
  const kind = resizingPane.value
  if (!kind) return
  persistPaneWidth(kind)
  resizingPane.value = null
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  window.removeEventListener('pointermove', onPaneResizeMove)
  window.removeEventListener('pointerup', stopPaneResize)
}

function prunePinnedChatIds(): void {
  const validIds = new Set([
    ...agentChats.value.map((chat) => agentSessionKey(chat.id)),
    ...groupChats.value.map((group) => groupSessionKey(group.id))
  ])
  const next = new Set([...pinnedChatIds.value].filter((id) => validIds.has(id)))
  if (next.size === pinnedChatIds.value.size) return
  pinnedChatIds.value = next
  writePinnedChatIds(next)
}

function toggleChatPinned(chat: ChatListItem): void {
  const next = new Set(pinnedChatIds.value)
  if (next.has(chat.id)) next.delete(chat.id)
  else next.add(chat.id)
  pinnedChatIds.value = next
  writePinnedChatIds(next)
}

function clearChatWorkspace(): void {
  activeSessionKey.value = null
  messages.value = []
  activeGroupBlackboard.value = null
  messagesLoading.value = false
  pendingReply.value = null
  runtime.value = idleRuntime()
}

function currentUserSender(): SenderInfo {
  const user = authState.user
  const name = user?.nickname?.trim() || user?.account || '我'
  return {
    id: 'me',
    name,
    role: 'user',
    initials: name.slice(0, 2).toUpperCase(),
    accent: 'primary',
    avatarDataUrl: user?.avatar ?? undefined
  }
}

function agentSender(chat: AgentChatView): SenderInfo {
  return {
    id: chat.agent.id,
    name: chat.agent.name,
    role: 'agent',
    initials: agentInitials(chat.agent.name),
    color: chat.agent.color,
    avatarDataUrl: chat.agent.avatar ?? undefined,
    accent: chat.agent.vendor === 'claude' ? 'green' : 'neutral'
  }
}

function runStepFromView(view: AgentRunStepView): AgentRunStep | null {
  const status: AgentRunStep['status'] =
    view.isError || view.toolStatus === 'failed' ? 'failed' : 'completed'
  if (view.type === 'thinking') {
    return {
      id: view.id,
      type: 'thinking',
      label: view.seq === 0 ? '思考中' : '继续思考',
      status,
      text: view.text ?? undefined
    }
  }
  if (view.type === 'progress') {
    return {
      id: view.id,
      type: 'progress',
      label: '过程输出',
      status,
      text: view.text ?? undefined
    }
  }
  if (view.type === 'tool') {
    return {
      id: view.id,
      type: 'tool',
      label: `正在调用 ${view.toolName ?? '工具'}`,
      status,
      toolName: view.toolName ?? undefined,
      toolUseId: view.toolUseId ?? undefined,
      input: view.input,
      output: view.output,
      isError: view.isError ?? undefined
    }
  }
  if (view.type === 'todo') {
    const todos = view.todos ?? []
    return {
      id: view.id,
      type: 'todo',
      label: planLabel(todos),
      status: 'completed',
      todos
    }
  }
  if (view.type === 'plan') {
    return {
      id: view.id,
      type: 'plan',
      label: '计划',
      status: 'completed',
      text: view.text ?? undefined
    }
  }
  return null
}

function agentRunFromView(view: AgentChatMessageView, chat: AgentChatView): AgentRunMessage {
  const steps = (view.steps ?? [])
    .map(runStepFromView)
    .filter((step): step is AgentRunStep => step !== null)
  return {
    id: view.id,
    chatId: view.chatId,
    kind: 'agent-run',
    timestamp: view.createdAt,
    sender: agentSender(chat),
    status: 'done',
    steps,
    text: view.text
  }
}

function messageFromView(view: AgentChatMessageView, chat: AgentChatView): ChatDisplayMessage {
  if (view.role === 'system') {
    return {
      id: view.id,
      chatId: view.chatId,
      kind: 'system',
      timestamp: view.createdAt,
      text: view.text
    }
  }

  if (view.role === 'agent' && view.steps && view.steps.length > 0) {
    return agentRunFromView(view, chat)
  }

  return {
    id: view.id,
    chatId: view.chatId,
    kind: 'text',
    timestamp: view.createdAt,
    sender: view.role === 'user' ? currentUserSender() : agentSender(chat),
    text: view.text
  }
}

function appendMessage(sessionKey: string, message: ChatDisplayMessage): void {
  const cached = messageCache.get(sessionKey) ?? []
  const next = [...cached, message]
  messageCache.set(sessionKey, next)
  if (activeSessionKey.value === sessionKey) messages.value = next
}

function updateCachedMessages(
  sessionKey: string,
  updater: (messages: ChatDisplayMessage[]) => ChatDisplayMessage[]
): void {
  const cached = messageCache.get(sessionKey) ?? []
  const next = updater(cached)
  messageCache.set(sessionKey, next)
  if (activeSessionKey.value === sessionKey) messages.value = next
}

function removeMessage(sessionKey: string, messageId: string): void {
  updateCachedMessages(sessionKey, (cached) => cached.filter((message) => message.id !== messageId))
}

function appendSystemMessage(sessionKey: string, text: string): void {
  appendMessage(sessionKey, {
    id: `m-system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatId: sessionKey,
    kind: 'system',
    timestamp: new Date().toISOString(),
    text
  })
}

function runStepId(type: AgentRunStep['type']): string {
  return `run-step-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function initialThinkingStep(): AgentRunStep {
  return {
    id: runStepId('thinking'),
    type: 'thinking',
    label: '思考中',
    status: 'active'
  }
}

function createRunMessage(
  runKey: string,
  sessionKey: string,
  sender: SenderInfo,
  firstStep: AgentRunStep = initialThinkingStep()
): AgentRunMessage {
  const message: AgentRunMessage = {
    id: `m-agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatId: sessionKey,
    kind: 'agent-run',
    timestamp: new Date().toISOString(),
    sender,
    status: 'thinking',
    steps: [firstStep],
    text: ''
  }
  runMessageIds.set(runKey, message.id)
  runMessageSessionKeys.set(runKey, sessionKey)
  appendMessage(sessionKey, message)
  return message
}

function createAgentRunMessage(chat: AgentChatView): AgentRunMessage {
  const key = agentSessionKey(chat.id)
  return createRunMessage(key, key, agentSender(chat))
}

function ensureAgentRunMessage(chat: AgentChatView): void {
  const key = agentSessionKey(chat.id)
  const cached = messageCache.get(key) ?? []
  const existingId = runMessageIds.get(key)
  if (existingId && cached.some((message) => message.id === existingId)) return

  const reusableId = findReusableRunMessageId(key)
  if (reusableId) {
    runMessageIds.set(key, reusableId)
    runMessageSessionKeys.set(key, key)
    return
  }
  createAgentRunMessage(chat)
}

function findReusableRunMessageId(sessionKey: string): string | null {
  const cached = messageCache.get(sessionKey) ?? []
  const reusable = cached
    .filter(
      (message): message is AgentRunMessage =>
        isAgentRunMessage(message) && message.status !== 'done' && message.status !== 'error'
    )
    .at(-1)
  return reusable?.id ?? null
}

function prepareRunMessageForReplay(chat: AgentChatView): string | null {
  const key = agentSessionKey(chat.id)
  const messageId = findReusableRunMessageId(key)
  if (!messageId) {
    runMessageIds.delete(key)
    runMessageSessionKeys.delete(key)
    return null
  }

  updateCachedMessages(key, (cached) =>
    cached.map((message) =>
      message.id === messageId && isAgentRunMessage(message)
        ? {
            ...message,
            status: 'thinking',
            steps: [initialThinkingStep()],
            text: ''
          }
        : message
    )
  )
  runMessageIds.set(key, messageId)
  runMessageSessionKeys.set(key, key)
  return messageId
}

function updateAgentRunMessage(
  runKey: string,
  updater: (message: AgentRunMessage) => AgentRunMessage
): void {
  const runMessageId = runMessageIds.get(runKey)
  if (!runMessageId) return
  const sessionKey = runMessageSessionKeys.get(runKey) ?? runKey
  updateCachedMessages(sessionKey, (cached) =>
    cached.map((message) =>
      message.id === runMessageId && isAgentRunMessage(message) ? updater(message) : message
    )
  )
}

function ensureRunMessage(
  runKey: string,
  sessionKey: string,
  sender: SenderInfo,
  firstStep: AgentRunStep = initialThinkingStep()
): void {
  const cached = messageCache.get(sessionKey) ?? []
  const existingId = runMessageIds.get(runKey)
  if (existingId && cached.some((message) => message.id === existingId)) return
  createRunMessage(runKey, sessionKey, sender, firstStep)
}

function startRunStep(
  chatId: string,
  type: AgentRunStep['type'],
  label: string,
  status: AgentRunMessage['status'],
  detail: Partial<AgentRunStep> = {}
): void {
  updateAgentRunMessage(chatId, (message) => {
    const last = message.steps[message.steps.length - 1]
    if (last?.status === 'active' && last.type === type && last.label === label) {
      return { ...message, status }
    }

    const steps = message.steps.map((step) =>
      step.status === 'active' ? { ...step, status: 'completed' as const } : step
    )
    return {
      ...message,
      status,
      steps: [...steps, { id: runStepId(type), type, label, status: 'active', ...detail }]
    }
  })
}

function appendProgressStep(chatId: string, text: string): void {
  updateAgentRunMessage(chatId, (message) => {
    const steps = message.steps.map((step) =>
      step.status === 'active' ? { ...step, status: 'completed' as const } : step
    )
    return {
      ...message,
      status: 'thinking',
      steps: [
        ...steps,
        {
          id: runStepId('progress'),
          type: 'progress',
          label: '过程输出',
          status: 'completed',
          text
        }
      ]
    }
  })
}

function completeActiveRunStep(
  chatId: string,
  failed = false,
  detail: Partial<AgentRunStep> = {}
): void {
  updateAgentRunMessage(chatId, (message) => ({
    ...message,
    steps: message.steps.map((step) =>
      step.status === 'active' || (detail.toolUseId && step.toolUseId === detail.toolUseId)
        ? {
            ...step,
            ...detail,
            status: failed ? ('failed' as const) : ('completed' as const)
          }
        : step
    )
  }))
}

function updateAgentRunText(chatId: string, text: string): void {
  completeActiveRunStep(chatId)
  updateAgentRunMessage(chatId, (message) => ({ ...message, status: 'responding', text }))
}

function finishAgentRun(chatId: string, success: boolean): void {
  completeActiveRunStep(chatId, !success)
  updateAgentRunMessage(chatId, (message) => ({
    ...message,
    status: success ? 'done' : 'error'
  }))
  runMessageIds.delete(chatId)
  runMessageSessionKeys.delete(chatId)
}

function removeCurrentAgentRun(sessionKey: string): void {
  const runMessageId = runMessageIds.get(sessionKey)
  if (!runMessageId) return
  removeMessage(sessionKey, runMessageId)
  runMessageIds.delete(sessionKey)
  runMessageSessionKeys.delete(sessionKey)
}

function planLabel(todos: AgentTodoItem[]): string {
  const done = todos.filter((todo) => todo.status === 'completed').length
  return `计划 · ${done}/${todos.length}`
}

function upsertTodoStep(chatId: string, todos: AgentTodoItem[]): void {
  updateAgentRunMessage(chatId, (message) => {
    const hasTodoStep = message.steps.some((step) => step.type === 'todo')
    if (hasTodoStep) {
      return {
        ...message,
        steps: message.steps.map((step) =>
          step.type === 'todo' ? { ...step, label: planLabel(todos), todos } : step
        )
      }
    }
    // todo 是全量快照、单例：用 completed 状态插入，避免干扰活动步骤推进逻辑
    return {
      ...message,
      steps: [
        ...message.steps,
        {
          id: runStepId('todo'),
          type: 'todo',
          label: planLabel(todos),
          status: 'completed',
          todos
        }
      ]
    }
  })
}

function upsertPlanStep(chatId: string, plan: string): void {
  updateAgentRunMessage(chatId, (message) => {
    const hasPlanStep = message.steps.some((step) => step.type === 'plan')
    if (hasPlanStep) {
      return {
        ...message,
        steps: message.steps.map((step) => (step.type === 'plan' ? { ...step, text: plan } : step))
      }
    }
    return {
      ...message,
      steps: [
        ...message.steps,
        { id: runStepId('plan'), type: 'plan', label: '计划', status: 'completed', text: plan }
      ]
    }
  })
}

function syncRunMessage(key: string, event: AgentEvent): void {
  switch (event.type) {
    case 'session_started':
    case 'turn_started':
      return
    case 'progress':
      appendProgressStep(key, event.text)
      return
    case 'thinking':
      startRunStep(key, 'thinking', '思考中', 'thinking')
      return
    case 'tool_use':
      if (event.status === 'started') {
        startRunStep(key, 'tool', `正在调用 ${event.name}`, 'tool', {
          toolName: event.name,
          toolUseId: event.id,
          input: event.input
        })
      } else {
        completeActiveRunStep(key, event.status === 'failed', { toolUseId: event.id })
      }
      return
    case 'tool_result':
      completeActiveRunStep(key, Boolean(event.isError), {
        toolUseId: event.toolUseId,
        output: event.output,
        isError: Boolean(event.isError)
      })
      if (!event.isError) startRunStep(key, 'thinking', '继续思考', 'thinking')
      return
    case 'text':
      return
    case 'todo':
      upsertTodoStep(key, event.items)
      return
    case 'plan':
      upsertPlanStep(key, event.plan)
      return
    case 'turn_completed':
      if (event.finalText) updateAgentRunText(key, event.finalText)
      completeActiveRunStep(key)
      return
    case 'error':
      completeActiveRunStep(key, true)
      updateAgentRunMessage(key, (message) => ({ ...message, status: 'error' }))
      return
    case 'done':
      if (event.finalText) updateAgentRunText(key, event.finalText)
      finishAgentRun(key, event.success)
      return
  }
}

function syncAgentRunMessage(chat: AgentChatView, event: AgentEvent): void {
  syncRunMessage(agentSessionKey(chat.id), event)
}

function groupRunOrchestratorKey(groupId: string, runId: string): string {
  return `${groupSessionKey(groupId)}:run:${runId}:orchestrator`
}

function groupRunMemberKey(
  groupId: string,
  runId: string,
  taskId: string,
  agentId: string
): string {
  return `${groupSessionKey(groupId)}:run:${runId}:task:${taskId}:agent:${agentId}`
}

function groupRunMemberChatKey(groupId: string, runId: string, agentId: string): string {
  return `${groupSessionKey(groupId)}:run:${runId}:member-chat:${agentId}`
}

function groupRunTaskStateKey(groupId: string, runId: string): string {
  return `${groupSessionKey(groupId)}:run:${runId}:tasks`
}

function groupTaskStatusLabel(status: BlackboardTaskNode['status']): string {
  const labels: Record<BlackboardTaskNode['status'], string> = {
    pending: '待分配',
    ready: '已分配',
    doing: '执行中',
    done: '已完成',
    failed: '失败',
    blocked: '已阻塞'
  }
  return labels[status]
}

function groupTaskAssignee(group: GroupChatView, agentId: string | null): string {
  if (!agentId) return '待分配'
  return group.members.find((member) => member.agentId === agentId)?.name ?? agentId
}

function groupTaskPlanText(group: GroupChatView, tasks: BlackboardTaskNode[]): string {
  return tasks
    .map((task, index) => {
      const assignee = groupTaskAssignee(group, task.agentId)
      const objective = task.objective.trim()
      const suffix = objective ? `\n   ${objective}` : ''
      return `${index + 1}. [${groupTaskStatusLabel(task.status)}] ${task.name} -> ${assignee}${suffix}`
    })
    .join('\n')
}

function groupTaskTodos(group: GroupChatView, tasks: BlackboardTaskNode[]): AgentTodoItem[] {
  return tasks.map((task) => ({
    text: `${task.name} -> ${groupTaskAssignee(group, task.agentId)}`,
    status:
      task.status === 'done' ? 'completed' : task.status === 'doing' ? 'in_progress' : 'pending'
  }))
}

function ensureGroupOrchestratorRunMessage(group: GroupChatView, runId: string): string {
  const sessionKey = groupSessionKey(group.id)
  const runKey = groupRunOrchestratorKey(group.id, runId)
  ensureRunMessage(runKey, sessionKey, groupOrchestratorSender(), {
    id: runStepId('thinking'),
    type: 'thinking',
    label: 'Orchestrator 编排中',
    status: 'active'
  })
  return runKey
}

function ensureGroupMemberRunMessage(
  group: GroupChatView,
  runId: string,
  taskId: string,
  agentId: string
): string {
  const sessionKey = groupSessionKey(group.id)
  const runKey = groupRunMemberKey(group.id, runId, taskId, agentId)
  ensureRunMessage(runKey, sessionKey, groupMemberSender(group, agentId))
  return runKey
}

function ensureGroupMemberChatRunMessage(
  group: GroupChatView,
  runId: string,
  agentId: string
): string {
  const sessionKey = groupSessionKey(group.id)
  const runKey = groupRunMemberChatKey(group.id, runId, agentId)
  ensureRunMessage(runKey, sessionKey, groupMemberSender(group, agentId))
  return runKey
}

function updateGroupPlanMessage(
  group: GroupChatView,
  runId: string,
  tasks: BlackboardTaskNode[],
  options: { startWaitingStep?: boolean } = {}
): void {
  groupRunTasks.set(groupRunTaskStateKey(group.id, runId), tasks)
  const runKey = ensureGroupOrchestratorRunMessage(group, runId)
  if (options.startWaitingStep) completeActiveRunStep(runKey)
  upsertPlanStep(runKey, groupTaskPlanText(group, tasks))
  upsertTodoStep(runKey, groupTaskTodos(group, tasks))
  if (options.startWaitingStep) startRunStep(runKey, 'thinking', '等待成员执行', 'thinking')
}

function updateGroupPlanTaskStatus(
  group: GroupChatView,
  event: Extract<GroupRunEvent, { type: 'task_status' }>
): void {
  const key = groupRunTaskStateKey(group.id, event.runId)
  const tasks = groupRunTasks.get(key)
  if (!tasks) return
  const next = tasks.map((task) =>
    task.id === event.taskId
      ? { ...task, status: event.status, agentId: event.agentId ?? task.agentId }
      : task
  )
  updateGroupPlanMessage(group, event.runId, next)
}

function finishGroupRunMessages(groupId: string, runId: string, success: boolean): void {
  const prefix = `${groupSessionKey(groupId)}:run:${runId}:`
  for (const key of [...runMessageIds.keys()]) {
    if (!key.startsWith(prefix)) continue
    finishAgentRun(key, success)
  }
  groupRunTasks.delete(groupRunTaskStateKey(groupId, runId))
}

function dropGroupRunMessageRefs(groupId: string, runId: string): void {
  const prefix = `${groupSessionKey(groupId)}:run:${runId}:`
  for (const key of [...runMessageIds.keys()]) {
    if (!key.startsWith(prefix)) continue
    runMessageIds.delete(key)
    runMessageSessionKeys.delete(key)
  }
  groupRunTasks.delete(groupRunTaskStateKey(groupId, runId))
}

async function loadWorkspace(): Promise<void> {
  chatsLoading.value = true
  try {
    const [chatList, groupList, agentList] = await Promise.all([
      agentChatApi.list(),
      groupChatApi.list(),
      agentApi.list()
    ])
    agentChats.value = chatList
    groupChats.value = groupList
    agents.value = agentList
    reconcileRunningIndicators()
    prunePinnedChatIds()
    const currentStillExists = activeSessionKey.value
      ? sessionExists(activeSessionKey.value)
      : false
    const initial = currentStillExists ? activeSessionKey.value : chats.value[0]?.id
    if (initial) await selectChat(initial)
    else clearChatWorkspace()
    void syncTurnWatchers()
    void syncGroupRunWatchers()
  } finally {
    chatsLoading.value = false
  }
}

async function refreshChats(): Promise<void> {
  const [chatList, groupList] = await Promise.all([agentChatApi.list(), groupChatApi.list()])
  agentChats.value = chatList
  groupChats.value = groupList
  prunePinnedChatIds()
  reconcileRunningIndicators()
  void syncTurnWatchers()
  void syncGroupRunWatchers()
}

async function refreshAgents(): Promise<void> {
  agentsLoading.value = true
  agentsError.value = null
  try {
    agents.value = await agentApi.list()
  } catch (err) {
    agentsError.value = err instanceof ApiError ? err.message : 'Agent 列表加载失败'
  } finally {
    agentsLoading.value = false
  }
}

async function openCreateChatDialog(): Promise<void> {
  createChatOpen.value = true
  await refreshAgents()
}

function openCreateGroupDialog(): void {
  createGroupOpen.value = true
}

function sessionExists(key: string): boolean {
  const kind = sessionKind(key)
  const id = sessionRawId(key)
  if (kind === 'agent') return agentChats.value.some((chat) => chat.id === id)
  if (kind === 'group') return groupChats.value.some((group) => group.id === id)
  return false
}

function groupMemberMeta(group: GroupChatView): Map<string, GroupSenderMeta> {
  const map = new Map<string, GroupSenderMeta>()
  for (const member of group.members) {
    map.set(member.agentId, {
      name: member.name,
      color: member.color,
      avatar: member.avatar
    })
  }
  return map
}

function groupOrchestratorSender(): SenderInfo {
  return {
    id: 'orchestrator',
    name: 'Orchestrator',
    role: 'orchestrator',
    icon: 'hub',
    accent: 'violet'
  }
}

function groupMemberSender(group: GroupChatView, agentId: string): SenderInfo {
  const member = group.members.find((item) => item.agentId === agentId)
  return {
    id: agentId,
    name: member?.name ?? 'Agent',
    role: 'agent',
    initials: agentInitials(member?.name ?? 'Agent'),
    color: member?.color,
    avatarDataUrl: member?.avatar ?? undefined,
    accent: 'green'
  }
}

async function loadMessages(sessionKey: string, silent = false): Promise<void> {
  const kind = sessionKind(sessionKey)
  if (kind === 'agent') {
    await loadAgentMessages(sessionRawId(sessionKey), sessionKey, silent)
  } else if (kind === 'group') {
    await loadGroupMessages(sessionRawId(sessionKey), sessionKey, silent)
  }
}

async function loadAgentMessages(
  chatId: string,
  sessionKey: string,
  silent = false
): Promise<void> {
  const chat = agentChats.value.find((item) => item.id === chatId)
  if (!chat) return

  const updatesActiveChat = activeSessionKey.value === sessionKey
  const loadId = updatesActiveChat ? ++activeLoadId : activeLoadId
  if (!silent && updatesActiveChat) {
    messagesLoading.value = true
    messages.value = []
  }

  try {
    const history = await agentChatApi.listMessages(chatId)
    const next = history.map((message) => messageFromView(message, chat))
    messageCache.set(sessionKey, next)
    if (updatesActiveChat && loadId === activeLoadId && activeSessionKey.value === sessionKey) {
      messages.value = next
    }
  } finally {
    if (updatesActiveChat && loadId === activeLoadId) messagesLoading.value = false
  }
}

async function loadGroupMessages(
  groupId: string,
  sessionKey: string,
  silent = false
): Promise<void> {
  const group = groupChats.value.find((item) => item.id === groupId)
  if (!group) return

  const updatesActiveChat = activeSessionKey.value === sessionKey
  const loadId = updatesActiveChat ? ++activeLoadId : activeLoadId
  if (!silent && updatesActiveChat) {
    messagesLoading.value = true
    messages.value = []
  }

  try {
    const history = await groupChatApi.listMessages(groupId)
    const members = groupMemberMeta(group)
    const next = history.map((message) =>
      groupMessageToDisplay(message, members, currentUserSender().name)
    )
    messageCache.set(sessionKey, next)
    if (updatesActiveChat && loadId === activeLoadId && activeSessionKey.value === sessionKey) {
      messages.value = next
    }
  } finally {
    if (updatesActiveChat && loadId === activeLoadId) messagesLoading.value = false
  }
}

async function loadGroupBlackboard(groupId: string): Promise<void> {
  const key = groupSessionKey(groupId)
  try {
    const next = await groupChatApi.getBlackboard(groupId)
    groupBlackboards.set(key, next)
    if (activeSessionKey.value === key) activeGroupBlackboard.value = next
  } catch {
    groupBlackboards.set(key, null)
    if (activeSessionKey.value === key) activeGroupBlackboard.value = null
  }
}

async function detachTurn(chatId: string): Promise<void> {
  const key = agentSessionKey(chatId)
  const stream = turnStreams.get(key)
  if (!stream) return
  turnStreams.delete(key)
  setChatRunning(key, false)
  // Only stop receiving; the turn keeps running server-side so other devices —
  // and this one on re-open — can still watch it.
  await stream.cancel()
}

async function detachAllTurns(): Promise<void> {
  const streams = [...turnStreams.values()]
  const groupRunStreams = [...groupStreams.values()]
  turnStreams.clear()
  groupStreams.clear()
  runningChatIds.value = new Set()
  await Promise.all([...streams, ...groupRunStreams].map((stream) => stream.cancel()))
}

async function selectChat(key: string): Promise<void> {
  activeSessionKey.value = key
  pendingReply.value = null
  previewArtifact.value = null
  runtime.value = idleRuntime()
  activeGroupBlackboard.value =
    sessionKind(key) === 'group' ? (groupBlackboards.get(key) ?? null) : null

  const cached = messageCache.get(key)
  if (cached) {
    messages.value = cached
    messagesLoading.value = false
  } else {
    await loadMessages(key)
  }

  const kind = sessionKind(key)
  const id = sessionRawId(key)
  if (kind === 'agent') {
    const chat = agentChats.value.find((item) => item.id === id)
    if (chat?.activeTurnId && activeSessionKey.value === key) {
      runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
      void watchTurn(chat, chat.activeTurnId)
    } else if (turnStreams.has(key)) {
      runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
    }
  } else if (kind === 'group') {
    if (!groupBlackboards.has(key)) void loadGroupBlackboard(id)
    const group = groupChats.value.find((item) => item.id === id)
    if (group?.activeRunId && activeSessionKey.value === key) {
      runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching group' }
      void watchGroupRun(group, group.activeRunId)
    } else if (groupStreams.has(key)) {
      runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching group' }
    }
  }
}

async function onChatCreated(chat: AgentChatView): Promise<void> {
  agentChats.value = [chat, ...agentChats.value.filter((item) => item.id !== chat.id)]
  await selectChat(agentSessionKey(chat.id))
  void refreshChats()
}

async function onGroupCreated(group: GroupChatView): Promise<void> {
  groupChats.value = [group, ...groupChats.value.filter((item) => item.id !== group.id)]
  createGroupOpen.value = false
  await selectChat(groupSessionKey(group.id))
  void refreshChats()
}

function requestDeleteChat(chat: ChatListItem): void {
  deleteChatTarget.value = chat
  deleteChatError.value = null
  deleteChatConfirmOpen.value = true
}

function closeDeleteChatDialog(): void {
  if (deletingChat.value) return
  deleteChatConfirmOpen.value = false
  deleteChatTarget.value = null
  deleteChatError.value = null
}

async function confirmDeleteChat(): Promise<void> {
  const chat = deleteChatTarget.value
  if (!chat) return

  const kind = sessionKind(chat.id)
  const id = sessionRawId(chat.id)
  deletingChat.value = true
  deleteChatError.value = null
  try {
    const deletingActiveChat = chat.id === activeSessionKey.value
    if (kind === 'agent') {
      if (isChatRunning(chat.id) || turnStreams.has(chat.id)) {
        // 删除前先停止进行中的轮（服务端 removeChat 对运行中会话会拒绝），再断开本端订阅
        await stopTurn(id)
        await detachTurn(id)
      }
      await agentChatApi.delete(id)
      agentChats.value = agentChats.value.filter((item) => item.id !== id)
      runMessageIds.delete(chat.id)
    } else if (kind === 'group') {
      if (isChatRunning(chat.id) || groupStreams.has(chat.id)) {
        await stopGroupRun(id)
        await detachGroupRun(id)
      }
      await groupChatApi.delete(id)
      groupChats.value = groupChats.value.filter((item) => item.id !== id)
      groupBlackboards.delete(chat.id)
    } else {
      throw new Error('未知会话类型')
    }

    messageCache.delete(chat.id)
    reconcileRunningIndicators()
    prunePinnedChatIds()

    deleteChatConfirmOpen.value = false
    deleteChatTarget.value = null

    if (!deletingActiveChat) return
    const nextChatId = chats.value[0]?.id
    if (nextChatId) await selectChat(nextChatId)
    else clearChatWorkspace()
  } catch (err) {
    deleteChatError.value = err instanceof ApiError ? err.message : '删除聊天失败'
  } finally {
    deletingChat.value = false
  }
}

function handleRuntimeEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'progress':
      runtime.value = { ...runtime.value, phase: 'thinking', label: 'Working', detail: event.text }
      return
    case 'thinking':
      runtime.value = { ...runtime.value, phase: 'thinking', label: 'Thinking', detail: event.text }
      return
    case 'tool_use':
      runtime.value = {
        ...runtime.value,
        phase: 'tool',
        label: event.status === 'completed' ? 'Tool completed' : 'Using tool',
        toolName: event.name
      }
      return
    case 'tool_result':
      runtime.value = {
        ...runtime.value,
        phase: event.isError ? 'error' : 'tool',
        label: event.isError ? 'Tool error' : 'Tool result'
      }
      return
    case 'todo':
      runtime.value = { ...runtime.value, todos: event.items }
      return
    case 'text':
      runtime.value = {
        ...runtime.value,
        phase: 'streaming',
        label: 'Responding',
        detail: undefined
      }
      return
    case 'turn_completed':
      // turn 结束信号：推进右侧 runtime，避免个别 vendor（如 codex）结束后仍停留在 thinking。
      // 真正的终态由后续 done 事件给出；这里只把 thinking 收尾为 streaming。
      runtime.value = {
        ...runtime.value,
        phase: 'streaming',
        label: 'Responding',
        detail: event.finalText ?? runtime.value.detail
      }
      return
    case 'error':
      runtime.value = { ...runtime.value, phase: 'error', label: 'Error', detail: event.message }
      return
    case 'done':
      runtime.value = {
        ...runtime.value,
        phase: event.success ? 'done' : 'error',
        label: event.success ? 'Done' : 'Error',
        detail: event.finalText
      }
      return
  }
}

/**
 * Build the event handlers that drive the in-progress agent-run message and the
 * right-panel runtime. Shared by both starting a turn (sendMessage) and watching
 * an already-running turn (watchTurn), so live progress renders identically
 * whether this device started the turn or is just observing it.
 */
function buildConverseHandlers(chat: AgentChatView, turnId: string): AgentConverseHandlers {
  const chatId = chat.id
  const key = agentSessionKey(chatId)
  let assistantText = ''
  let agentFinished = false
  let success = false

  return {
    onEvent(event) {
      const activeStream = turnStreams.get(key)
      if (activeStream && activeStream.turnId !== turnId) return
      ensureAgentRunMessage(chat)
      if (event.type === 'done') {
        agentFinished = true
        success = event.success
      }
      if (activeSessionKey.value === key) handleRuntimeEvent(event)
      syncAgentRunMessage(chat, event)
      if (event.type === 'text') {
        assistantText = assistantText ? `${assistantText}\n\n${event.text}` : event.text
        updateAgentRunText(key, assistantText)
      } else if (event.type === 'error' && event.fatal && !assistantText) {
        appendSystemMessage(key, event.message)
      }
    },
    onError(message) {
      const activeStream = turnStreams.get(key)
      if (activeStream && activeStream.turnId !== turnId) return
      finishAgentRun(key, false)
      if (activeSessionKey.value === key) {
        runtime.value = { ...runtime.value, phase: 'error', label: 'Stream error', detail: message }
      }
      appendSystemMessage(key, message)
    },
    onDone() {
      const activeStream = turnStreams.get(key)
      if (activeStream && activeStream.turnId !== turnId) return
      turnStreams.delete(key)
      setChatRunning(key, false)
      markChatActiveTurn(chatId, null)
      if (!agentFinished) {
        // 流结束但没收到 Agent done：多半只是本端订阅断开了，turn 可能仍在服务端运行。
        // 刷新 activeTurnId 后若仍活跃，立刻重连到 Redis Stream 的 backlog + live tail。
        void reloadAfterStreamDrop(chatId)
      } else {
        runMessageIds.delete(key)
        notifyTurnCompleted(chat, turnId, success)
        void reloadAfterTurn(chatId)
      }
    }
  }
}

/** turn 结束后用 DB 权威历史覆盖本地乐观态，确保多端最终一致 */
async function reloadAfterTurn(chatId: string): Promise<void> {
  await refreshChats()
  await loadMessages(agentSessionKey(chatId), true)
}

/** 订阅意外断开时恢复围观；若后端已结束，则回落为一次普通历史刷新 */
async function reloadAfterStreamDrop(chatId: string): Promise<void> {
  await refreshChats()

  const chat = agentChats.value.find((item) => item.id === chatId)
  if (chat?.activeTurnId) {
    void watchTurn(chat, chat.activeTurnId)
    return
  }

  runMessageIds.delete(agentSessionKey(chatId))
  await loadMessages(agentSessionKey(chatId), true)
}

/** 订阅一个进行中的 turn 的事件流（回放 + 实时追尾），用于围观 */
async function watchTurn(chat: AgentChatView, turnId: string): Promise<void> {
  const key = agentSessionKey(chat.id)
  const existing = turnStreams.get(key)
  if (existing?.turnId === turnId) {
    setChatRunning(key, true)
    return
  }
  if (existing) await detachTurn(chat.id)

  setChatRunning(key, true)
  markChatActiveTurn(chat.id, turnId)
  if (!messageCache.has(key)) {
    try {
      await loadMessages(key, true)
    } catch {
      /* Live replay can still render; history reload is retried after the turn settles. */
    }
  }
  prepareRunMessageForReplay(chat)
  if (activeSessionKey.value === key) {
    runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
  }

  const stream = agentChatApi.subscribeTurn(chat.id, turnId, buildConverseHandlers(chat, turnId))
  turnStreams.set(key, stream)
  stream.started.catch(() => {
    if (turnStreams.get(key)?.turnId !== turnId) return
    turnStreams.delete(key)
    setChatRunning(key, false)
    runMessageIds.delete(key)
    void reloadAfterTurn(chat.id)
  })
}

function syncTurnWatchers(): void {
  for (const [key, stream] of turnStreams) {
    const chatId = sessionRawId(key)
    const chat = agentChats.value.find((item) => item.id === chatId)
    if (!chat) {
      void stream.cancel()
      turnStreams.delete(key)
      setChatRunning(key, false)
      continue
    }
    if (chat.activeTurnId && chat.activeTurnId !== stream.turnId) {
      void detachTurn(chatId).then(() => {
        if (chat.activeTurnId) void watchTurn(chat, chat.activeTurnId)
      })
    }
  }

  for (const chat of agentChats.value) {
    if (!chat.activeTurnId) continue
    if (turnStreams.get(agentSessionKey(chat.id))?.turnId === chat.activeTurnId) continue
    void watchTurn(chat, chat.activeTurnId)
  }
}

function notifyTurnCompleted(chat: AgentChatView, turnId: string, success: boolean): void {
  if (notifiedTurnIds.has(turnId)) return
  notifiedTurnIds.add(turnId)

  const BrowserNotification = window.Notification
  if (!BrowserNotification) return

  const title = success ? 'Agent 任务已完成' : 'Agent 任务未完成'
  const body = titleForChat(chat)
  const show = (): void => {
    try {
      new BrowserNotification(title, { body })
    } catch {
      /* Notifications are best-effort; the chat history remains the source of truth. */
    }
  }

  if (BrowserNotification.permission === 'granted') {
    show()
    return
  }
  if (BrowserNotification.permission === 'default') {
    void BrowserNotification.requestPermission().then((permission) => {
      if (permission === 'granted') show()
    })
  }
}

function markGroupActiveRun(groupId: string, runId: string | null): void {
  groupChats.value = groupChats.value.map((group) =>
    group.id === groupId ? { ...group, activeRunId: runId } : group
  )
}

function handleGroupRuntimeEvent(event: GroupRunEvent): void {
  switch (event.type) {
    case 'orchestrator_plan':
      runtime.value = { ...runtime.value, phase: 'thinking', label: '已生成任务计划' }
      return
    case 'task_status':
      runtime.value = {
        ...runtime.value,
        phase: event.status === 'failed' || event.status === 'blocked' ? 'error' : 'thinking',
        label: `任务进度：${groupTaskStatusLabel(event.status)}`
      }
      return
    case 'member_turn_event': {
      const inner = event.event
      if (inner.type === 'progress') {
        runtime.value = {
          ...runtime.value,
          phase: 'thinking',
          label: '成员执行中',
          detail: inner.text
        }
      } else if (inner.type === 'tool_use') {
        runtime.value = {
          ...runtime.value,
          phase: 'tool',
          label: '成员调用工具',
          toolName: inner.name
        }
      } else if (inner.type === 'thinking') {
        runtime.value = { ...runtime.value, phase: 'thinking', label: '成员思考中' }
      } else if (inner.type === 'text') {
        runtime.value = { ...runtime.value, phase: 'streaming', label: '成员输出中' }
      }
      return
    }
    case 'blackboard_update':
      runtime.value = { ...runtime.value, phase: 'thinking', label: event.update.summary }
      return
    case 'orchestrator_report':
      runtime.value = { ...runtime.value, phase: 'streaming', label: '汇总中', detail: event.text }
      return
    case 'done':
      runtime.value = {
        ...runtime.value,
        phase: event.success ? 'done' : 'error',
        label: event.success ? 'Done' : 'Error'
      }
      return
  }
}

function buildGroupRunHandlers(
  group: GroupChatView,
  runId: string
): {
  onEvent(event: GroupRunEvent): void
  onError?(message: string): void
  onDone?(): void
} {
  const groupId = group.id
  const key = groupSessionKey(groupId)
  const memberTexts = new Map<string, string>()
  const completedMemberKeys = new Set<string>()
  let groupFinished = false
  let success = false

  return {
    onEvent(event) {
      const activeStream = groupStreams.get(key)
      if (activeStream && activeStream.runId !== runId) return
      if (event.type === 'done') {
        groupFinished = true
        success = event.success
      }
      if (activeSessionKey.value === key) handleGroupRuntimeEvent(event)

      if (event.type === 'orchestrator_plan') {
        updateGroupPlanMessage(group, runId, event.tasks, { startWaitingStep: true })
      } else if (event.type === 'task_status') {
        updateGroupPlanTaskStatus(group, event)
        if (event.agentId) {
          const memberKey = groupRunMemberKey(groupId, runId, event.taskId, event.agentId)
          if (!completedMemberKeys.has(memberKey)) {
            ensureGroupMemberRunMessage(group, runId, event.taskId, event.agentId)
            if (event.status === 'doing') {
              startRunStep(memberKey, 'thinking', '执行任务中', 'thinking')
            } else if (event.status === 'ready') {
              startRunStep(memberKey, 'thinking', '等待执行', 'thinking')
            } else if (event.status === 'done' || event.status === 'failed') {
              finishAgentRun(memberKey, event.status === 'done')
              completedMemberKeys.add(memberKey)
            } else if (event.status === 'blocked') {
              // 上游失败导致本任务从未派发：收尾该成员运行卡片，避免 UI 一直转圈
              finishAgentRun(memberKey, false)
              completedMemberKeys.add(memberKey)
            }
          }
        }
      } else if (event.type === 'member_turn_event') {
        const memberKey =
          event.taskId === null
            ? groupRunMemberChatKey(groupId, runId, event.agentId)
            : groupRunMemberKey(groupId, runId, event.taskId, event.agentId)
        if (!completedMemberKeys.has(memberKey)) {
          if (event.taskId === null) {
            ensureGroupMemberChatRunMessage(group, runId, event.agentId)
          } else {
            ensureGroupMemberRunMessage(group, runId, event.taskId, event.agentId)
          }
          syncRunMessage(memberKey, event.event)
          if (event.event.type === 'done') completedMemberKeys.add(memberKey)
          if (event.event.type === 'text') {
            const existingText = memberTexts.get(memberKey)
            const nextText = existingText
              ? `${existingText}\n\n${event.event.text}`
              : event.event.text
            memberTexts.set(memberKey, nextText)
            updateAgentRunText(memberKey, nextText)
          } else if (
            event.event.type === 'error' &&
            event.event.fatal &&
            !memberTexts.get(memberKey)
          ) {
            appendSystemMessage(key, event.event.message)
          }
        }
      } else if (event.type === 'orchestrator_report') {
        const orchestratorKey = ensureGroupOrchestratorRunMessage(group, runId)
        updateAgentRunText(orchestratorKey, event.text)
      } else if (event.type === 'done') {
        finishGroupRunMessages(groupId, runId, event.success)
      }

      if (
        event.type === 'orchestrator_plan' ||
        event.type === 'task_status' ||
        event.type === 'blackboard_update'
      ) {
        void loadGroupBlackboard(groupId)
      }
    },
    onError(message) {
      const activeStream = groupStreams.get(key)
      if (activeStream && activeStream.runId !== runId) return
      if (activeSessionKey.value === key) {
        runtime.value = { ...runtime.value, phase: 'error', label: 'Stream error', detail: message }
      }
      appendSystemMessage(key, message)
    },
    onDone() {
      const activeStream = groupStreams.get(key)
      if (activeStream && activeStream.runId !== runId) return
      groupStreams.delete(key)
      setChatRunning(key, false)
      markGroupActiveRun(groupId, null)
      if (!groupFinished) {
        dropGroupRunMessageRefs(groupId, runId)
        void reloadAfterGroupStreamDrop(groupId)
      } else {
        notifyGroupRunCompleted(group, runId, success)
        void reloadAfterGroupRun(groupId)
      }
    }
  }
}

async function reloadAfterGroupRun(groupId: string): Promise<void> {
  const key = groupSessionKey(groupId)
  await refreshChats()
  await Promise.all([loadMessages(key, true), loadGroupBlackboard(groupId)])
}

async function reloadAfterGroupStreamDrop(groupId: string): Promise<void> {
  await refreshChats()

  const group = groupChats.value.find((item) => item.id === groupId)
  if (group?.activeRunId) {
    void watchGroupRun(group, group.activeRunId)
    return
  }

  const key = groupSessionKey(groupId)
  await Promise.all([loadMessages(key, true), loadGroupBlackboard(groupId)])
}

async function watchGroupRun(group: GroupChatView, runId: string): Promise<void> {
  const key = groupSessionKey(group.id)
  const existing = groupStreams.get(key)
  if (existing?.runId === runId) {
    setChatRunning(key, true)
    return
  }
  if (existing) await detachGroupRun(group.id)

  setChatRunning(key, true)
  markGroupActiveRun(group.id, runId)
  if (!messageCache.has(key)) {
    try {
      await loadMessages(key, true)
    } catch {
      /* Live replay can still render; history reload is retried after the run settles. */
    }
  }
  if (activeSessionKey.value === key) {
    runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching group' }
  }
  ensureGroupOrchestratorRunMessage(group, runId)

  const stream = groupChatApi.subscribeRun(group.id, runId, buildGroupRunHandlers(group, runId))
  groupStreams.set(key, stream)
  stream.started.catch(() => {
    if (groupStreams.get(key)?.runId !== runId) return
    groupStreams.delete(key)
    setChatRunning(key, false)
    dropGroupRunMessageRefs(group.id, runId)
    void reloadAfterGroupRun(group.id)
  })
}

function syncGroupRunWatchers(): void {
  for (const [key, stream] of groupStreams) {
    const groupId = sessionRawId(key)
    const group = groupChats.value.find((item) => item.id === groupId)
    if (!group) {
      void stream.cancel()
      groupStreams.delete(key)
      setChatRunning(key, false)
      continue
    }
    if (group.activeRunId && group.activeRunId !== stream.runId) {
      void detachGroupRun(groupId).then(() => {
        if (group.activeRunId) void watchGroupRun(group, group.activeRunId)
      })
    }
  }

  for (const group of groupChats.value) {
    if (!group.activeRunId) continue
    if (groupStreams.get(groupSessionKey(group.id))?.runId === group.activeRunId) continue
    void watchGroupRun(group, group.activeRunId)
  }
}

function notifyGroupRunCompleted(group: GroupChatView, runId: string, success: boolean): void {
  if (notifiedGroupRunIds.has(runId)) return
  notifiedGroupRunIds.add(runId)

  const BrowserNotification = window.Notification
  if (!BrowserNotification) return

  const title = success ? '群聊任务已完成' : '群聊任务未完成'
  const body = group.title
  const show = (): void => {
    try {
      new BrowserNotification(title, { body })
    } catch {
      /* Notifications are best-effort; the chat history remains the source of truth. */
    }
  }

  if (BrowserNotification.permission === 'granted') {
    show()
    return
  }
  if (BrowserNotification.permission === 'default') {
    void BrowserNotification.requestPermission().then((permission) => {
      if (permission === 'granted') show()
    })
  }
}

/** 主动停止当前 turn（服务端中止，影响所有观看端） */
async function stopTurn(chatId: string): Promise<void> {
  const key = agentSessionKey(chatId)
  const stream = turnStreams.get(key)
  const turnId = stream?.turnId ?? agentChats.value.find((chat) => chat.id === chatId)?.activeTurnId
  if (!turnId) return
  try {
    await agentChatApi.abortTurn(chatId, turnId)
  } catch {
    /* 已结束或不可达：忽略，done 事件会收尾 */
  }
}

async function stopGroupRun(groupId: string): Promise<void> {
  const key = groupSessionKey(groupId)
  const stream = groupStreams.get(key)
  const runId = stream?.runId ?? groupChats.value.find((group) => group.id === groupId)?.activeRunId
  if (!runId) return
  try {
    await groupChatApi.abortRun(groupId, runId)
  } catch {
    /* 已结束或不可达：忽略，done 事件会收尾 */
  }
}

async function detachGroupRun(groupId: string): Promise<void> {
  const key = groupSessionKey(groupId)
  const stream = groupStreams.get(key)
  if (!stream) return
  groupStreams.delete(key)
  setChatRunning(key, false)
  await stream.cancel()
}

async function stopCurrentTurn(): Promise<void> {
  const key = activeSessionKey.value
  if (!key) return
  const kind = sessionKind(key)
  const id = sessionRawId(key)
  if (kind === 'agent') await stopTurn(id)
  else if (kind === 'group') await stopGroupRun(id)
}

async function sendMessage(payload: { text: string; replyTo?: MessageReplyRef }): Promise<void> {
  if (activeChat.value) {
    await sendAgentMessage(payload)
    return
  }
  if (activeGroup.value) {
    await sendGroupMessage(payload)
  }
}

async function sendAgentMessage(payload: {
  text: string
  replyTo?: MessageReplyRef
}): Promise<void> {
  const chat = activeChat.value
  if (!chat || streaming.value) return

  const chatId = chat.id
  const key = agentSessionKey(chatId)
  const prompt = payload.text
  const userMessage: TextMessage = {
    id: `m-user-${Date.now()}`,
    chatId: key,
    kind: 'text',
    timestamp: new Date().toISOString(),
    sender: currentUserSender(),
    text: prompt,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {})
  }

  appendMessage(key, userMessage)
  pendingReply.value = null
  setChatRunning(key, true)
  runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Starting' }

  let stream: AgentConverseStream | null = null
  let handlers: AgentConverseHandlers | null = null
  const earlyEvents: AgentEvent[] = []
  const earlyErrors: string[] = []
  let earlyDone = false
  const proxyHandlers: AgentConverseHandlers = {
    onEvent(event) {
      if (handlers) handlers.onEvent(event)
      else earlyEvents.push(event)
    },
    onError(message) {
      if (handlers) handlers.onError?.(message)
      else earlyErrors.push(message)
    },
    onDone() {
      if (handlers) handlers.onDone?.()
      else earlyDone = true
    }
  }

  try {
    stream = await agentChatApi.converse(chatId, prompt, proxyHandlers)
    handlers = buildConverseHandlers(chat, stream.turnId)
    turnStreams.set(key, stream)
    markChatActiveTurn(chatId, stream.turnId)
    for (const event of earlyEvents) handlers.onEvent(event)
    for (const message of earlyErrors) handlers.onError?.(message)
    if (earlyDone) handlers.onDone?.()
    await stream.started
  } catch (err) {
    if (stream) {
      turnStreams.delete(key)
      setChatRunning(key, false)
      void reloadAfterStreamDrop(chatId)
      return
    }
    removeMessage(key, userMessage.id)
    if (activeSessionKey.value !== key) return
    setChatRunning(key, false)
    removeCurrentAgentRun(key)
    const message = err instanceof Error ? err.message : String(err)
    runtime.value = { ...runtime.value, phase: 'error', label: 'Error', detail: message }
    appendSystemMessage(key, message)
  }
}

async function sendGroupMessage(payload: {
  text: string
  replyTo?: MessageReplyRef
}): Promise<void> {
  const group = activeGroup.value
  if (!group || streaming.value) return

  const groupId = group.id
  const key = groupSessionKey(groupId)
  const prompt = payload.text
  const userMessage: TextMessage = {
    id: `m-user-${Date.now()}`,
    chatId: key,
    kind: 'text',
    timestamp: new Date().toISOString(),
    sender: currentUserSender(),
    text: prompt,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {})
  }

  appendMessage(key, userMessage)
  pendingReply.value = null
  setChatRunning(key, true)
  runtime.value = { ...idleRuntime(), phase: 'streaming', label: '启动群聊任务' }

  let stream: GroupRunStream | null = null
  let handlers: ReturnType<typeof buildGroupRunHandlers> | null = null
  const earlyEvents: GroupRunEvent[] = []
  const earlyErrors: string[] = []
  let earlyDone = false
  const proxyHandlers = {
    onEvent(event: GroupRunEvent): void {
      if (handlers) handlers.onEvent(event)
      else earlyEvents.push(event)
    },
    onError(message: string): void {
      if (handlers) handlers.onError?.(message)
      else earlyErrors.push(message)
    },
    onDone(): void {
      if (handlers) handlers.onDone?.()
      else earlyDone = true
    }
  }

  try {
    stream = await groupChatApi.converse(groupId, { text: prompt }, proxyHandlers)
    handlers = buildGroupRunHandlers(group, stream.runId)
    groupStreams.set(key, stream)
    markGroupActiveRun(groupId, stream.runId)
    ensureGroupOrchestratorRunMessage(group, stream.runId)
    for (const event of earlyEvents) handlers.onEvent(event)
    for (const message of earlyErrors) handlers.onError?.(message)
    if (earlyDone) handlers.onDone?.()
    await stream.started
    await loadGroupBlackboard(groupId)
  } catch (err) {
    if (stream) {
      groupStreams.delete(key)
      setChatRunning(key, false)
      dropGroupRunMessageRefs(groupId, stream.runId)
      void reloadAfterGroupStreamDrop(groupId)
      return
    }
    removeMessage(key, userMessage.id)
    if (activeSessionKey.value !== key) return
    setChatRunning(key, false)
    const message = err instanceof Error ? err.message : String(err)
    runtime.value = { ...runtime.value, phase: 'error', label: 'Error', detail: message }
    appendSystemMessage(key, message)
  }
}

async function onSelectOption(payload: {
  message: OptionsMessage
  option: OptionItem
}): Promise<void> {
  const { message, option } = payload
  if (message.answered) return
  await sendMessage({ text: option.label })
}

async function onReplyOption(payload: { message: OptionsMessage; text: string }): Promise<void> {
  if (payload.message.answered) return
  await sendMessage({ text: payload.text })
}

function messageToPlainText(msg: ChatDisplayMessage): string {
  if (isAgentRunMessage(msg)) {
    const text = msg.text.trim()
    if (text) return text
    return msg.steps.map((step) => step.label).join('\n')
  }

  switch (msg.kind) {
    case 'system':
      return msg.text
    case 'text':
      return msg.text
    case 'task-list':
      return [msg.heading, ...msg.tasks.map((t) => `- ${t.title} [${t.status}]`)].join('\n')
    case 'options':
      return [msg.text, ...msg.options.map((o) => `- ${o.label}`)].join('\n')
  }
}

function messageExcerpt(msg: ChatDisplayMessage): string {
  const text = messageToPlainText(msg).replace(/\s+/g, ' ').trim()
  return text.length > 80 ? text.slice(0, 80) + '...' : text
}

function messageSenderName(msg: ChatDisplayMessage): string {
  return msg.kind === 'system' ? '系统' : msg.sender.name
}

function onPinMessage(msg: ChatDisplayMessage): void {
  const key = activeSessionKey.value
  if (!key) return
  const next = messages.value.map((message) =>
    message.id === msg.id ? { ...message, pinned: !message.pinned } : message
  )
  messageCache.set(key, next)
  messages.value = next
}

function onUnpinFromBar(msg: ChatDisplayMessage): void {
  const key = activeSessionKey.value
  if (!key) return
  const next = messages.value.map((m) => (m.id === msg.id ? { ...m, pinned: false } : m))
  messageCache.set(key, next)
  messages.value = next
}

function onJumpToMessage(msg: ChatDisplayMessage): void {
  messageListRef.value?.scrollToMessage(msg.id)
}

async function onCopyMessage(msg: ChatDisplayMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(messageToPlainText(msg))
  } catch {
    /* clipboard may be unavailable in some sandboxes; silently no-op */
  }
}

function onReplyMessage(msg: ChatDisplayMessage): void {
  pendingReply.value = {
    messageId: msg.id,
    senderName: messageSenderName(msg),
    excerpt: messageExcerpt(msg)
  }
}

function onCancelReply(): void {
  pendingReply.value = null
}

onMounted(() => {
  normalizePaneWidths()
  window.addEventListener('resize', normalizePaneWidths)
  void loadWorkspace()
})
onUnmounted(() => {
  window.removeEventListener('resize', normalizePaneWidths)
  stopPaneResize()
  // 只断开本端订阅，turn 在服务端继续运行；重新打开或在其它设备仍可围观
  void detachAllTurns()
})
</script>

<template>
  <div class="flex flex-1 h-full min-w-0">
    <ChatList
      :style="{ width: `${chatListWidth}px` }"
      :chats="chats"
      :active-chat-id="activeSessionKey"
      :loading="chatsLoading"
      @select="selectChat"
      @create-chat="openCreateChatDialog"
      @create-group-chat="openCreateGroupDialog"
      @toggle-pin="toggleChatPinned"
      @delete-chat="requestDeleteChat"
    />
    <div class="relative z-20 h-full w-0 flex-shrink-0">
      <div
        class="absolute inset-y-0 -left-1 w-2 cursor-col-resize bg-transparent"
        role="separator"
        aria-label="调整聊天列表宽度"
        aria-orientation="vertical"
        @pointerdown="startPaneResize('chat-list', $event)"
        @dragstart.prevent
      ></div>
    </div>
    <main class="flex-1 flex flex-col h-full bg-surface min-w-0 relative">
      <ChatHeader :detail="chatDetail" />
      <PinnedBar
        :messages="messages"
        :to-text="messageToPlainText"
        :sender-name="messageSenderName"
        @unpin="onUnpinFromBar"
        @jump="onJumpToMessage"
      />
      <MessageList
        ref="messageListRef"
        :messages="messages"
        :loading="messagesLoading"
        @select-option="onSelectOption"
        @reply-option="onReplyOption"
        @pin-message="onPinMessage"
        @copy-message="onCopyMessage"
        @reply-message="onReplyMessage"
      />
      <MessageInput
        :reply-to="pendingReply"
        :disabled="streaming || !activeSessionKey"
        :streaming="streaming"
        @send="sendMessage"
        @cancel-reply="onCancelReply"
        @stop="stopCurrentTurn"
      />
    </main>
    <div class="relative z-20 h-full w-0 flex-shrink-0">
      <div
        class="absolute inset-y-0 -left-1 w-2 cursor-col-resize bg-transparent"
        role="separator"
        aria-label="调整状态工作区宽度"
        aria-orientation="vertical"
        @pointerdown="startPaneResize('inspector', $event)"
        @dragstart.prevent
      ></div>
    </div>
    <GroupDetailPanel
      v-if="activeGroup"
      :style="{ width: `${inspectorWidth}px` }"
      :group="activeGroup"
      :blackboard="activeGroupBlackboard"
      mode="inspector"
      @open-artifact="previewArtifact = $event"
    />
    <RightInspector
      v-else
      :style="{ width: `${inspectorWidth}px` }"
      :network="[]"
      :chat="activeChat"
      :runtime="runtime"
    />
    <ArtifactPreviewDrawer
      :group-id="activeGroup?.id ?? null"
      :artifact="previewArtifact"
      @close="previewArtifact = null"
    />
    <AgentChatCreateDialog
      :open="createChatOpen"
      :agents="agents"
      :loading="agentsLoading"
      :load-error="agentsError"
      @close="createChatOpen = false"
      @created="onChatCreated"
    />
    <GroupChatCreateDialog
      :open="createGroupOpen"
      @close="createGroupOpen = false"
      @created="onGroupCreated"
    />
    <ConfirmDialog
      :open="deleteChatConfirmOpen"
      title="删除聊天"
      :message="deleteChatMessage"
      confirm-label="删除"
      confirming-label="删除中..."
      :confirming="deletingChat"
      @close="closeDeleteChatDialog"
      @confirm="confirmDeleteChat"
    />
  </div>
</template>
