<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  AgentChatMessageView,
  AgentChatView,
  AgentEvent,
  AgentRunStepView,
  AgentTodoItem,
  AgentView,
  ChatDetail,
  ChatSummary,
  MessageReplyRef,
  OptionItem,
  OptionsMessage,
  SenderInfo,
  TextMessage
} from '../api'
import { ApiError, agentApi } from '../api'
import { agentChatApi, type AgentConverseHandlers, type AgentConverseStream } from '../api/agents'
import { authState } from '../stores/auth'
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
import ConfirmDialog from '../components/ConfirmDialog.vue'

type RuntimePhase = 'idle' | 'thinking' | 'tool' | 'streaming' | 'error' | 'done'
type ChatListItem = ChatSummary & { pinned: boolean; running?: boolean; updatedAt?: string }

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

interface AgentRuntimeState {
  phase: RuntimePhase
  label: string
  detail?: string
  toolName?: string
  todos: AgentTodoItem[]
}

const agentChats = ref<AgentChatView[]>([])
const agents = ref<AgentView[]>([])
const activeChatId = ref<string | null>(null)
const messages = ref<ChatDisplayMessage[]>([])
const chatListWidth = ref(readStoredWidth(CHAT_LIST_WIDTH_STORAGE_KEY, CHAT_LIST_DEFAULT_WIDTH))
const inspectorWidth = ref(readStoredWidth(INSPECTOR_WIDTH_STORAGE_KEY, INSPECTOR_DEFAULT_WIDTH))
const resizingPane = ref<'chat-list' | 'inspector' | null>(null)
const messageCache = new Map<string, ChatDisplayMessage[]>()
const turnStreams = new Map<string, AgentConverseStream>()
const runMessageIds = new Map<string, string>()
const notifiedTurnIds = new Set<string>()
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
const pinnedChatIds = ref<Set<string>>(readPinnedChatIds())
const deleteChatTarget = ref<ChatListItem | null>(null)
const deleteChatConfirmOpen = ref(false)
const deletingChat = ref(false)
const deleteChatError = ref<string | null>(null)

const pendingReply = ref<MessageReplyRef | null>(null)
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const runtime = ref<AgentRuntimeState>(idleRuntime())

const activeChat = computed(
  () => agentChats.value.find((chat) => chat.id === activeChatId.value) ?? null
)

const streaming = computed(() =>
  activeChatId.value ? runningChatIds.value.has(activeChatId.value) : false
)

const chats = computed<ChatListItem[]>(() =>
  agentChats.value
    .map((chat, index) => ({
      chat,
      index,
      pinned: pinnedChatIds.value.has(chat.id)
    }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.index - b.index
    })
    .map(({ chat, pinned }) => ({
      id: chat.id,
      title: titleForChat(chat),
      preview: previewForChat(chat),
      kind: 'agent',
      avatar: {
        kind: 'initials',
        text: agentInitials(chat.agent.name),
        color: chat.agent.color,
        avatarDataUrl: chat.agent.avatar ?? undefined,
        tone: chat.status === 'active' ? 'primary' : 'neutral'
      },
      active: chat.id === activeChatId.value,
      pinned,
      running: isChatRunning(chat.id),
      updatedAt: chat.lastTurnAt ?? chat.updatedAt
    }))
)

const deleteChatMessage = computed(() => {
  const chat = deleteChatTarget.value
  if (!chat) return ''
  const base = `确认删除聊天「${chat.title}」？聊天记录会一并删除。`
  return deleteChatError.value ? `${base}\n${deleteChatError.value}` : base
})

const chatDetail = computed<ChatDetail | null>(() => {
  const chat = activeChat.value
  if (!chat) return null
  return {
    id: chat.id,
    title: titleForChat(chat),
    status: runtime.value.phase === 'error' ? 'Error' : statusLabel(chat.status),
    agentCount: 1
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

function titleForChat(chat: AgentChatView): string {
  const custom = chat.title?.trim()
  if (custom) return custom
  return `${chat.agent.name} ${formatTime(chat.createdAt)}`
}

function previewForChat(chat: AgentChatView): string {
  if (isChatRunning(chat.id)) {
    if (chat.id === activeChatId.value) return runtime.value.label
    return '正在运行'
  }
  if (chat.lastTurnAt) return `最近 ${formatTime(chat.lastTurnAt)}`
  return `${chat.agent.vendor} / ${chat.agent.model}`
}

function isChatRunning(chatId: string): boolean {
  return runningChatIds.value.has(chatId)
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
  const next = new Set(turnStreams.keys())
  for (const chat of agentChats.value) {
    if (chat.activeTurnId) next.add(chat.id)
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
  const validIds = new Set(agentChats.value.map((chat) => chat.id))
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
  activeChatId.value = null
  messages.value = []
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

function appendMessage(chatId: string, message: ChatDisplayMessage): void {
  const cached = messageCache.get(chatId) ?? []
  const next = [...cached, message]
  messageCache.set(chatId, next)
  if (activeChatId.value === chatId) messages.value = next
}

function updateCachedMessages(
  chatId: string,
  updater: (messages: ChatDisplayMessage[]) => ChatDisplayMessage[]
): void {
  const cached = messageCache.get(chatId) ?? []
  const next = updater(cached)
  messageCache.set(chatId, next)
  if (activeChatId.value === chatId) messages.value = next
}

function removeMessage(chatId: string, messageId: string): void {
  updateCachedMessages(chatId, (cached) => cached.filter((message) => message.id !== messageId))
}

function appendSystemMessage(chatId: string, text: string): void {
  appendMessage(chatId, {
    id: `m-system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatId,
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

function createAgentRunMessage(chat: AgentChatView): AgentRunMessage {
  const message: AgentRunMessage = {
    id: `m-agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatId: chat.id,
    kind: 'agent-run',
    timestamp: new Date().toISOString(),
    sender: agentSender(chat),
    status: 'thinking',
    steps: [initialThinkingStep()],
    text: ''
  }
  runMessageIds.set(chat.id, message.id)
  appendMessage(chat.id, message)
  return message
}

function ensureAgentRunMessage(chat: AgentChatView): void {
  const cached = messageCache.get(chat.id) ?? []
  const existingId = runMessageIds.get(chat.id)
  if (existingId && cached.some((message) => message.id === existingId)) return

  const reusableId = findReusableRunMessageId(chat.id)
  if (reusableId) {
    runMessageIds.set(chat.id, reusableId)
    return
  }
  createAgentRunMessage(chat)
}

function findReusableRunMessageId(chatId: string): string | null {
  const cached = messageCache.get(chatId) ?? []
  const reusable = cached
    .filter(
      (message): message is AgentRunMessage =>
        isAgentRunMessage(message) && message.status !== 'done' && message.status !== 'error'
    )
    .at(-1)
  return reusable?.id ?? null
}

function prepareRunMessageForReplay(chat: AgentChatView): string | null {
  const messageId = findReusableRunMessageId(chat.id)
  if (!messageId) {
    runMessageIds.delete(chat.id)
    return null
  }

  updateCachedMessages(chat.id, (cached) =>
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
  runMessageIds.set(chat.id, messageId)
  return messageId
}

function updateAgentRunMessage(
  chatId: string,
  updater: (message: AgentRunMessage) => AgentRunMessage
): void {
  const runMessageId = runMessageIds.get(chatId)
  if (!runMessageId) return
  updateCachedMessages(chatId, (cached) =>
    cached.map((message) =>
      message.id === runMessageId && isAgentRunMessage(message) ? updater(message) : message
    )
  )
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
}

function removeCurrentAgentRun(chatId: string): void {
  const runMessageId = runMessageIds.get(chatId)
  if (!runMessageId) return
  removeMessage(chatId, runMessageId)
  runMessageIds.delete(chatId)
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
        steps: message.steps.map((step) =>
          step.type === 'plan' ? { ...step, text: plan } : step
        )
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

function syncAgentRunMessage(chat: AgentChatView, event: AgentEvent): void {
  switch (event.type) {
    case 'progress':
      appendProgressStep(chat.id, event.text)
      return
    case 'thinking':
      startRunStep(chat.id, 'thinking', '思考中', 'thinking')
      return
    case 'tool_use':
      if (event.status === 'started') {
        startRunStep(chat.id, 'tool', `正在调用 ${event.name}`, 'tool', {
          toolName: event.name,
          toolUseId: event.id,
          input: event.input
        })
      } else {
        completeActiveRunStep(chat.id, event.status === 'failed', { toolUseId: event.id })
      }
      return
    case 'tool_result':
      completeActiveRunStep(chat.id, Boolean(event.isError), {
        toolUseId: event.toolUseId,
        output: event.output,
        isError: Boolean(event.isError)
      })
      if (!event.isError) startRunStep(chat.id, 'thinking', '继续思考', 'thinking')
      return
    case 'text':
      return
    case 'todo':
      upsertTodoStep(chat.id, event.items)
      return
    case 'plan':
      upsertPlanStep(chat.id, event.plan)
      return
    case 'turn_completed':
      if (event.finalText) updateAgentRunText(chat.id, event.finalText)
      completeActiveRunStep(chat.id)
      return
    case 'error':
      completeActiveRunStep(chat.id, true)
      updateAgentRunMessage(chat.id, (message) => ({ ...message, status: 'error' }))
      return
    case 'done':
      if (event.finalText) updateAgentRunText(chat.id, event.finalText)
      finishAgentRun(chat.id, event.success)
      return
  }
}

async function loadWorkspace(): Promise<void> {
  chatsLoading.value = true
  try {
    const [chatList, agentList] = await Promise.all([agentChatApi.list(), agentApi.list()])
    agentChats.value = chatList
    agents.value = agentList
    reconcileRunningIndicators()
    const currentStillExists = agentChats.value.some((chat) => chat.id === activeChatId.value)
    const initial = currentStillExists ? activeChatId.value : agentChats.value[0]?.id
    prunePinnedChatIds()
    if (initial) await selectChat(initial)
    else clearChatWorkspace()
    void syncTurnWatchers()
  } finally {
    chatsLoading.value = false
  }
}

async function refreshChats(): Promise<void> {
  agentChats.value = await agentChatApi.list()
  prunePinnedChatIds()
  reconcileRunningIndicators()
  void syncTurnWatchers()
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

async function loadMessages(chatId: string, silent = false): Promise<void> {
  const chat = agentChats.value.find((item) => item.id === chatId)
  if (!chat) return

  const updatesActiveChat = activeChatId.value === chatId
  const loadId = updatesActiveChat ? ++activeLoadId : activeLoadId
  if (!silent && updatesActiveChat) {
    messagesLoading.value = true
    messages.value = []
  }

  try {
    const history = await agentChatApi.listMessages(chatId)
    const next = history.map((message) => messageFromView(message, chat))
    messageCache.set(chatId, next)
    if (updatesActiveChat && loadId === activeLoadId && activeChatId.value === chatId) {
      messages.value = next
    }
  } finally {
    if (updatesActiveChat && loadId === activeLoadId) messagesLoading.value = false
  }
}

async function detachTurn(chatId: string): Promise<void> {
  const stream = turnStreams.get(chatId)
  if (!stream) return
  turnStreams.delete(chatId)
  setChatRunning(chatId, false)
  // Only stop receiving; the turn keeps running server-side so other devices —
  // and this one on re-open — can still watch it.
  await stream.cancel()
}

async function detachAllTurns(): Promise<void> {
  const streams = [...turnStreams.entries()]
  turnStreams.clear()
  runningChatIds.value = new Set()
  await Promise.all(streams.map(([, stream]) => stream.cancel()))
}

async function selectChat(id: string): Promise<void> {
  activeChatId.value = id
  pendingReply.value = null
  runtime.value = idleRuntime()

  const cached = messageCache.get(id)
  if (cached) {
    messages.value = cached
    messagesLoading.value = false
  } else {
    await loadMessages(id)
  }

  // 若该聊天有进行中的轮（可能由本端早前发起、或其它设备发起），订阅其进度实现围观
  const chat = agentChats.value.find((item) => item.id === id)
  if (chat?.activeTurnId && activeChatId.value === id) {
    runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
    void watchTurn(chat, chat.activeTurnId)
  } else if (turnStreams.has(id)) {
    runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
  }
}

async function onChatCreated(chat: AgentChatView): Promise<void> {
  agentChats.value = [chat, ...agentChats.value.filter((item) => item.id !== chat.id)]
  await selectChat(chat.id)
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

  deletingChat.value = true
  deleteChatError.value = null
  try {
    const deletingActiveChat = chat.id === activeChatId.value
    if (isChatRunning(chat.id) || turnStreams.has(chat.id)) {
      // 删除前先停止进行中的轮（服务端 removeChat 对运行中会话会拒绝），再断开本端订阅
      await stopTurn(chat.id)
      await detachTurn(chat.id)
    }
    await agentChatApi.delete(chat.id)

    messageCache.delete(chat.id)
    runMessageIds.delete(chat.id)
    agentChats.value = agentChats.value.filter((item) => item.id !== chat.id)
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
  let assistantText = ''
  let agentFinished = false
  let success = false

  return {
    onEvent(event) {
      const activeStream = turnStreams.get(chatId)
      if (activeStream && activeStream.turnId !== turnId) return
      ensureAgentRunMessage(chat)
      if (event.type === 'done') {
        agentFinished = true
        success = event.success
      }
      if (activeChatId.value === chatId) handleRuntimeEvent(event)
      syncAgentRunMessage(chat, event)
      if (event.type === 'text') {
        assistantText = assistantText ? `${assistantText}\n\n${event.text}` : event.text
        updateAgentRunText(chatId, assistantText)
      } else if (event.type === 'error' && event.fatal && !assistantText) {
        appendSystemMessage(chatId, event.message)
      }
    },
    onError(message) {
      const activeStream = turnStreams.get(chatId)
      if (activeStream && activeStream.turnId !== turnId) return
      finishAgentRun(chatId, false)
      if (activeChatId.value === chatId) {
        runtime.value = { ...runtime.value, phase: 'error', label: 'Stream error', detail: message }
      }
      appendSystemMessage(chatId, message)
    },
    onDone() {
      const activeStream = turnStreams.get(chatId)
      if (activeStream && activeStream.turnId !== turnId) return
      turnStreams.delete(chatId)
      setChatRunning(chatId, false)
      markChatActiveTurn(chatId, null)
      if (!agentFinished) {
        // 流结束但没收到 Agent done：多半只是本端订阅断开了，turn 可能仍在服务端运行。
        // 刷新 activeTurnId 后若仍活跃，立刻重连到 Redis Stream 的 backlog + live tail。
        void reloadAfterStreamDrop(chatId)
      } else {
        runMessageIds.delete(chatId)
        notifyTurnCompleted(chat, turnId, success)
        void reloadAfterTurn(chatId)
      }
    }
  }
}

/** turn 结束后用 DB 权威历史覆盖本地乐观态，确保多端最终一致 */
async function reloadAfterTurn(chatId: string): Promise<void> {
  await refreshChats()
  await loadMessages(chatId, true)
}

/** 订阅意外断开时恢复围观；若后端已结束，则回落为一次普通历史刷新 */
async function reloadAfterStreamDrop(chatId: string): Promise<void> {
  await refreshChats()

  const chat = agentChats.value.find((item) => item.id === chatId)
  if (chat?.activeTurnId) {
    void watchTurn(chat, chat.activeTurnId)
    return
  }

  runMessageIds.delete(chatId)
  await loadMessages(chatId, true)
}

/** 订阅一个进行中的 turn 的事件流（回放 + 实时追尾），用于围观 */
async function watchTurn(chat: AgentChatView, turnId: string): Promise<void> {
  const existing = turnStreams.get(chat.id)
  if (existing?.turnId === turnId) {
    setChatRunning(chat.id, true)
    return
  }
  if (existing) await detachTurn(chat.id)

  setChatRunning(chat.id, true)
  markChatActiveTurn(chat.id, turnId)
  if (!messageCache.has(chat.id)) {
    try {
      await loadMessages(chat.id, true)
    } catch {
      /* Live replay can still render; history reload is retried after the turn settles. */
    }
  }
  prepareRunMessageForReplay(chat)
  if (activeChatId.value === chat.id) {
    runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Watching' }
  }

  const stream = agentChatApi.subscribeTurn(chat.id, turnId, buildConverseHandlers(chat, turnId))
  turnStreams.set(chat.id, stream)
  stream.started.catch(() => {
    if (turnStreams.get(chat.id)?.turnId !== turnId) return
    turnStreams.delete(chat.id)
    setChatRunning(chat.id, false)
    runMessageIds.delete(chat.id)
    void reloadAfterTurn(chat.id)
  })
}

function syncTurnWatchers(): void {
  for (const [chatId, stream] of turnStreams) {
    const chat = agentChats.value.find((item) => item.id === chatId)
    if (!chat) {
      void stream.cancel()
      turnStreams.delete(chatId)
      setChatRunning(chatId, false)
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
    if (turnStreams.get(chat.id)?.turnId === chat.activeTurnId) continue
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

/** 主动停止当前 turn（服务端中止，影响所有观看端） */
async function stopTurn(chatId: string): Promise<void> {
  const stream = turnStreams.get(chatId)
  const turnId = stream?.turnId ?? agentChats.value.find((chat) => chat.id === chatId)?.activeTurnId
  if (!turnId) return
  try {
    await agentChatApi.abortTurn(chatId, turnId)
  } catch {
    /* 已结束或不可达：忽略，done 事件会收尾 */
  }
}

async function stopCurrentTurn(): Promise<void> {
  const chatId = activeChatId.value
  if (!chatId) return
  await stopTurn(chatId)
}

async function sendMessage(payload: { text: string; replyTo?: MessageReplyRef }): Promise<void> {
  const chat = activeChat.value
  if (!chat || streaming.value) return

  const chatId = chat.id
  const prompt = payload.text
  const userMessage: TextMessage = {
    id: `m-user-${Date.now()}`,
    chatId,
    kind: 'text',
    timestamp: new Date().toISOString(),
    sender: currentUserSender(),
    text: prompt,
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {})
  }

  appendMessage(chatId, userMessage)
  pendingReply.value = null
  setChatRunning(chatId, true)
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
    turnStreams.set(chatId, stream)
    markChatActiveTurn(chatId, stream.turnId)
    for (const event of earlyEvents) handlers.onEvent(event)
    for (const message of earlyErrors) handlers.onError?.(message)
    if (earlyDone) handlers.onDone?.()
    await stream.started
  } catch (err) {
    if (stream) {
      turnStreams.delete(chatId)
      setChatRunning(chatId, false)
      void reloadAfterStreamDrop(chatId)
      return
    }
    removeMessage(chatId, userMessage.id)
    if (activeChatId.value !== chatId) return
    setChatRunning(chatId, false)
    removeCurrentAgentRun(chatId)
    const message = err instanceof Error ? err.message : String(err)
    runtime.value = { ...runtime.value, phase: 'error', label: 'Error', detail: message }
    appendSystemMessage(chatId, message)
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
  const chatId = activeChatId.value
  if (!chatId) return
  const next = messages.value.map((message) =>
    message.id === msg.id ? { ...message, pinned: !message.pinned } : message
  )
  messageCache.set(chatId, next)
  messages.value = next
}

function onUnpinFromBar(msg: ChatDisplayMessage): void {
  const chatId = activeChatId.value
  if (!chatId) return
  const next = messages.value.map((m) => (m.id === msg.id ? { ...m, pinned: false } : m))
  messageCache.set(chatId, next)
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
      :active-chat-id="activeChatId"
      :loading="chatsLoading"
      @select="selectChat"
      @create-chat="openCreateChatDialog"
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
        :disabled="streaming || !activeChatId"
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
    <RightInspector
      :style="{ width: `${inspectorWidth}px` }"
      :network="[]"
      :chat="activeChat"
      :runtime="runtime"
    />
    <AgentChatCreateDialog
      :open="createChatOpen"
      :agents="agents"
      :loading="agentsLoading"
      :load-error="agentsError"
      @close="createChatOpen = false"
      @created="onChatCreated"
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
