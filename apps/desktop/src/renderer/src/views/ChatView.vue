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
import { agentChatApi, type AgentConverseStream } from '../api/agents'
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
type ChatListItem = ChatSummary & { pinned: boolean }

const PINNED_CHAT_IDS_STORAGE_KEY = 'agenthub:pinned-chat-ids'

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
const messageCache = new Map<string, ChatDisplayMessage[]>()
let activeLoadId = 0
let currentStream: AgentConverseStream | null = null
let currentRunMessageId: string | null = null

const chatsLoading = ref(false)
const agentsLoading = ref(false)
const agentsError = ref<string | null>(null)
const messagesLoading = ref(false)
const streaming = ref(false)
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
      pinned
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
  if (chat.id === activeChatId.value && streaming.value) return runtime.value.label
  if (chat.lastTurnAt) return `最近 ${formatTime(chat.lastTurnAt)}`
  return `${chat.agent.vendor} / ${chat.agent.model}`
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
  currentRunMessageId = null
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
  // todo 步骤不在运行条里复原（实时态走独立面板）
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

function createAgentRunMessage(chat: AgentChatView): AgentRunMessage {
  const message: AgentRunMessage = {
    id: `m-agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    chatId: chat.id,
    kind: 'agent-run',
    timestamp: new Date().toISOString(),
    sender: agentSender(chat),
    status: 'thinking',
    steps: [
      {
        id: runStepId('thinking'),
        type: 'thinking',
        label: '思考中',
        status: 'active'
      }
    ],
    text: ''
  }
  currentRunMessageId = message.id
  appendMessage(chat.id, message)
  return message
}

function updateAgentRunMessage(
  chatId: string,
  updater: (message: AgentRunMessage) => AgentRunMessage
): void {
  if (!currentRunMessageId) return
  updateCachedMessages(chatId, (cached) =>
    cached.map((message) =>
      message.id === currentRunMessageId && isAgentRunMessage(message) ? updater(message) : message
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
  currentRunMessageId = null
}

function removeCurrentAgentRun(chatId: string): void {
  if (!currentRunMessageId) return
  removeMessage(chatId, currentRunMessageId)
  currentRunMessageId = null
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
    const currentStillExists = agentChats.value.some((chat) => chat.id === activeChatId.value)
    const initial = currentStillExists ? activeChatId.value : agentChats.value[0]?.id
    prunePinnedChatIds()
    if (initial) await selectChat(initial)
    else clearChatWorkspace()
  } finally {
    chatsLoading.value = false
  }
}

async function refreshChats(): Promise<void> {
  agentChats.value = await agentChatApi.list()
  prunePinnedChatIds()
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

  const loadId = ++activeLoadId
  if (!silent) {
    messagesLoading.value = true
    messages.value = []
  }

  try {
    const history = await agentChatApi.listMessages(chatId)
    const next = history.map((message) => messageFromView(message, chat))
    messageCache.set(chatId, next)
    if (loadId === activeLoadId && activeChatId.value === chatId) messages.value = next
  } finally {
    if (loadId === activeLoadId) messagesLoading.value = false
  }
}

async function cancelCurrentStream(): Promise<void> {
  if (!currentStream) return
  const stream = currentStream
  currentStream = null
  streaming.value = false
  if (activeChatId.value) removeCurrentAgentRun(activeChatId.value)
  await stream.cancel()
}

async function selectChat(id: string): Promise<void> {
  if (id !== activeChatId.value) await cancelCurrentStream()
  activeChatId.value = id
  pendingReply.value = null
  currentRunMessageId = null
  runtime.value = idleRuntime()

  const cached = messageCache.get(id)
  if (cached) {
    messages.value = cached
    messagesLoading.value = false
    return
  }

  await loadMessages(id)
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
    if (deletingActiveChat) await cancelCurrentStream()
    await agentChatApi.delete(chat.id)

    messageCache.delete(chat.id)
    agentChats.value = agentChats.value.filter((item) => item.id !== chat.id)
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
  streaming.value = true
  runtime.value = { ...idleRuntime(), phase: 'streaming', label: 'Starting' }
  createAgentRunMessage(chat)

  let assistantText = ''
  let agentFinished = false

  try {
    const stream = agentChatApi.converse(chatId, prompt, {
      onEvent(event) {
        if (activeChatId.value !== chatId) return
        if (event.type === 'done') agentFinished = true
        handleRuntimeEvent(event)
        syncAgentRunMessage(chat, event)
        if (event.type === 'text') {
          assistantText = assistantText ? `${assistantText}\n\n${event.text}` : event.text
          updateAgentRunText(chatId, assistantText)
        } else if (event.type === 'error' && event.fatal && !assistantText) {
          appendSystemMessage(chatId, event.message)
        }
      },
      onError(message) {
        if (activeChatId.value !== chatId) return
        finishAgentRun(chatId, false)
        runtime.value = { ...runtime.value, phase: 'error', label: 'Stream error', detail: message }
        appendSystemMessage(chatId, message)
      },
      onDone() {
        if (activeChatId.value !== chatId) return
        streaming.value = false
        currentStream = null
        if (!agentFinished) {
          const message = 'Stream ended before agent sent a final done event'
          finishAgentRun(chatId, false)
          runtime.value = {
            ...runtime.value,
            phase: 'error',
            label: 'Stream ended',
            detail: message
          }
          appendSystemMessage(chatId, message)
        }
        void refreshChats()
      }
    })
    currentStream = stream
    await stream.started
  } catch (err) {
    removeMessage(chatId, userMessage.id)
    if (activeChatId.value !== chatId) return
    streaming.value = false
    currentStream = null
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

onMounted(loadWorkspace)
onUnmounted(() => {
  void cancelCurrentStream()
})
</script>

<template>
  <div class="flex flex-1 h-full min-w-0">
    <ChatList
      :chats="chats"
      :active-chat-id="activeChatId"
      :loading="chatsLoading"
      @select="selectChat"
      @create-chat="openCreateChatDialog"
      @toggle-pin="toggleChatPinned"
      @delete-chat="requestDeleteChat"
    />
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
        @send="sendMessage"
        @cancel-reply="onCancelReply"
      />
    </main>
    <RightInspector :network="[]" :chat="activeChat" :runtime="runtime" />
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
