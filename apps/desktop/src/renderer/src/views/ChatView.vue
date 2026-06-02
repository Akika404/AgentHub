<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type {
  AgentChatMessageView,
  AgentChatView,
  AgentEvent,
  AgentTodoItem,
  AgentView,
  ChatDetail,
  ChatMessage,
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
import { agentInitials } from '../utils/avatar'
import { formatTime } from '../utils/format'
import ChatList from '../components/ChatList.vue'
import ChatHeader from '../components/ChatHeader.vue'
import MessageList from '../components/MessageList.vue'
import MessageInput from '../components/MessageInput.vue'
import RightInspector from '../components/RightInspector.vue'
import PinnedBar from '../components/PinnedBar.vue'
import AgentChatCreateDialog from '../components/AgentChatCreateDialog.vue'

type RuntimePhase = 'idle' | 'thinking' | 'tool' | 'streaming' | 'error' | 'done'

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
const messages = ref<ChatMessage[]>([])
const messageCache = new Map<string, ChatMessage[]>()
let activeLoadId = 0
let currentStream: AgentConverseStream | null = null

const chatsLoading = ref(false)
const agentsLoading = ref(false)
const agentsError = ref<string | null>(null)
const messagesLoading = ref(false)
const streaming = ref(false)
const createChatOpen = ref(false)

const pendingReply = ref<MessageReplyRef | null>(null)
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)
const runtime = ref<AgentRuntimeState>(idleRuntime())

const activeChat = computed(
  () => agentChats.value.find((chat) => chat.id === activeChatId.value) ?? null
)

const chats = computed<ChatSummary[]>(() =>
  agentChats.value.map((chat) => ({
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
    active: chat.id === activeChatId.value
  }))
)

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

function messageFromView(view: AgentChatMessageView, chat: AgentChatView): ChatMessage {
  if (view.role === 'system') {
    return {
      id: view.id,
      chatId: view.chatId,
      kind: 'system',
      timestamp: view.createdAt,
      text: view.text
    }
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

function appendMessage(chatId: string, message: ChatMessage): void {
  const cached = messageCache.get(chatId) ?? []
  const next = [...cached, message]
  messageCache.set(chatId, next)
  if (activeChatId.value === chatId) messages.value = next
}

function updateMessage(chatId: string, messageId: string, text: string): void {
  const cached = messageCache.get(chatId) ?? []
  const next = cached.map((message) =>
    message.id === messageId && message.kind === 'text' ? { ...message, text } : message
  )
  messageCache.set(chatId, next)
  if (activeChatId.value === chatId) messages.value = next
}

function removeMessage(chatId: string, messageId: string): void {
  const cached = messageCache.get(chatId) ?? []
  const next = cached.filter((message) => message.id !== messageId)
  messageCache.set(chatId, next)
  if (activeChatId.value === chatId) messages.value = next
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

async function loadWorkspace(): Promise<void> {
  chatsLoading.value = true
  try {
    const [chatList, agentList] = await Promise.all([agentChatApi.list(), agentApi.list()])
    agentChats.value = chatList
    agents.value = agentList
    const currentStillExists = agentChats.value.some((chat) => chat.id === activeChatId.value)
    const initial = currentStillExists ? activeChatId.value : agentChats.value[0]?.id
    if (initial) await selectChat(initial)
    else {
      activeChatId.value = null
      messages.value = []
      messagesLoading.value = false
      runtime.value = idleRuntime()
    }
  } finally {
    chatsLoading.value = false
  }
}

async function refreshChats(): Promise<void> {
  agentChats.value = await agentChatApi.list()
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
  await stream.cancel()
}

async function selectChat(id: string): Promise<void> {
  if (id !== activeChatId.value) await cancelCurrentStream()
  activeChatId.value = id
  pendingReply.value = null
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

function handleRuntimeEvent(event: AgentEvent): void {
  switch (event.type) {
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
      runtime.value = { ...runtime.value, phase: 'streaming', label: 'Responding' }
      return
    case 'error':
      runtime.value = { ...runtime.value, phase: 'error', label: 'Error', detail: event.message }
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

  let assistantMessageId: string | null = null
  let assistantText = ''

  try {
    const stream = agentChatApi.converse(chatId, prompt, {
      onEvent(event) {
        if (activeChatId.value !== chatId) return
        handleRuntimeEvent(event)
        if (event.type === 'text') {
          assistantText += event.text
          if (!assistantMessageId) {
            assistantMessageId = `m-agent-${Date.now()}`
            appendMessage(chatId, {
              id: assistantMessageId,
              chatId,
              kind: 'text',
              timestamp: new Date().toISOString(),
              sender: agentSender(chat),
              text: assistantText
            })
          } else {
            updateMessage(chatId, assistantMessageId, assistantText)
          }
        } else if (event.type === 'error' && event.fatal && !assistantText) {
          appendSystemMessage(chatId, event.message)
        }
      },
      onError(message) {
        if (activeChatId.value !== chatId) return
        runtime.value = { ...runtime.value, phase: 'error', label: 'Stream error', detail: message }
        appendSystemMessage(chatId, message)
      },
      onDone() {
        if (activeChatId.value !== chatId) return
        streaming.value = false
        currentStream = null
        void loadMessages(chatId, true)
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

function messageToPlainText(msg: ChatMessage): string {
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

function messageExcerpt(msg: ChatMessage): string {
  const text = messageToPlainText(msg).replace(/\s+/g, ' ').trim()
  return text.length > 80 ? text.slice(0, 80) + '...' : text
}

function messageSenderName(msg: ChatMessage): string {
  return msg.kind === 'system' ? '系统' : msg.sender.name
}

function onPinMessage(msg: ChatMessage): void {
  const chatId = activeChatId.value
  if (!chatId) return
  const next = messages.value.map((m) =>
    m.id === msg.id ? ({ ...m, pinned: !m.pinned } as ChatMessage) : m
  )
  messageCache.set(chatId, next)
  messages.value = next
}

function onUnpinFromBar(msg: ChatMessage): void {
  const chatId = activeChatId.value
  if (!chatId) return
  const next = messages.value.map((m) =>
    m.id === msg.id ? ({ ...m, pinned: false } as ChatMessage) : m
  )
  messageCache.set(chatId, next)
  messages.value = next
}

function onJumpToMessage(msg: ChatMessage): void {
  messageListRef.value?.scrollToMessage(msg.id)
}

async function onCopyMessage(msg: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(messageToPlainText(msg))
  } catch {
    /* clipboard may be unavailable in some sandboxes; silently no-op */
  }
}

function onReplyMessage(msg: ChatMessage): void {
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
  </div>
</template>
