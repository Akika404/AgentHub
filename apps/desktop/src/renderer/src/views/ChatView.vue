<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  api,
  type ChatDetail,
  type ChatMessage,
  type ChatSummary,
  type MessageReplyRef,
  type NetworkNode,
  type OptionItem,
  type OptionsMessage
} from '../api'
import ChatList from '../components/ChatList.vue'
import ChatHeader from '../components/ChatHeader.vue'
import MessageList from '../components/MessageList.vue'
import MessageInput from '../components/MessageInput.vue'
import RightInspector from '../components/RightInspector.vue'
import PinnedBar from '../components/PinnedBar.vue'

// The chat experience is still backed by the local mock service.
const chats = ref<ChatSummary[]>([])
const activeChatId = ref<string | null>(null)
const chatDetail = ref<ChatDetail | null>(null)
const messages = ref<ChatMessage[]>([])
const network = ref<NetworkNode[]>([])

const chatsLoading = ref(false)
const messagesLoading = ref(false)

const pendingReply = ref<MessageReplyRef | null>(null)
const messageListRef = ref<InstanceType<typeof MessageList> | null>(null)

async function loadChats(): Promise<void> {
  chatsLoading.value = true
  try {
    chats.value = await api.listChats()
    const initial = chats.value.find((c) => c.active) ?? chats.value[0]
    if (initial) await selectChat(initial.id)
  } finally {
    chatsLoading.value = false
  }
}

async function selectChat(id: string): Promise<void> {
  activeChatId.value = id
  messagesLoading.value = true
  pendingReply.value = null
  try {
    const [detail, msgs, net] = await Promise.all([
      api.getChatDetail(id),
      api.listMessages(id),
      api.getNetwork(id)
    ])
    chatDetail.value = detail
    messages.value = msgs
    network.value = net
  } finally {
    messagesLoading.value = false
  }
}

async function sendMessage(payload: { text: string; replyTo?: MessageReplyRef }): Promise<void> {
  if (!activeChatId.value) return
  const message = await api.sendMessage(activeChatId.value, payload.text, payload.replyTo)
  messages.value = [...messages.value, message]
  pendingReply.value = null
}

async function onSelectOption(payload: {
  message: OptionsMessage
  option: OptionItem
}): Promise<void> {
  const { message, option } = payload
  if (message.answered) return
  messages.value = messages.value.map((m) =>
    m.id === message.id && m.kind === 'options'
      ? { ...m, answered: true, answeredOptionId: option.id }
      : m
  )
  const text = `@${message.sender.name} ${option.label}`
  const replyTo: MessageReplyRef = {
    messageId: message.id,
    senderName: message.sender.name,
    excerpt: message.text
  }
  await sendMessage({ text, replyTo })
}

async function onReplyOption(payload: { message: OptionsMessage; text: string }): Promise<void> {
  const { message, text } = payload
  if (message.answered) return
  messages.value = messages.value.map((m) =>
    m.id === message.id && m.kind === 'options' ? { ...m, answered: true } : m
  )
  const body = `@${message.sender.name} ${text}`
  const replyTo: MessageReplyRef = {
    messageId: message.id,
    senderName: message.sender.name,
    excerpt: message.text
  }
  await sendMessage({ text: body, replyTo })
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
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}

function messageSenderName(msg: ChatMessage): string {
  return msg.kind === 'system' ? '系统' : msg.sender.name
}

function onPinMessage(msg: ChatMessage): void {
  messages.value = messages.value.map((m) =>
    m.id === msg.id ? ({ ...m, pinned: !m.pinned } as ChatMessage) : m
  )
}

function onUnpinFromBar(msg: ChatMessage): void {
  messages.value = messages.value.map((m) =>
    m.id === msg.id ? ({ ...m, pinned: false } as ChatMessage) : m
  )
}

function onJumpToMessage(msg: ChatMessage): void {
  messageListRef.value?.scrollToMessage(msg.id)
}

async function onCopyMessage(msg: ChatMessage): Promise<void> {
  const text = messageToPlainText(msg)
  try {
    await navigator.clipboard.writeText(text)
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

watch(activeChatId, (id) => {
  chats.value = chats.value.map((c) => ({ ...c, active: c.id === id }))
})

onMounted(loadChats)
</script>

<template>
  <div class="flex flex-1 h-full min-w-0">
    <ChatList
      :chats="chats"
      :active-chat-id="activeChatId"
      :loading="chatsLoading"
      @select="selectChat"
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
      <MessageInput :reply-to="pendingReply" @send="sendMessage" @cancel-reply="onCancelReply" />
    </main>
    <RightInspector :network="network" />
  </div>
</template>
