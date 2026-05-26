<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, type ChatDetail, type ChatMessage, type ChatSummary, type NetworkNode } from './api'
import GlobalSidebar from './components/GlobalSidebar.vue'
import ChatList from './components/ChatList.vue'
import ChatHeader from './components/ChatHeader.vue'
import MessageList from './components/MessageList.vue'
import MessageInput from './components/MessageInput.vue'
import RightInspector from './components/RightInspector.vue'

const nav = ref<'chat' | 'agents' | 'settings'>('chat')

const chats = ref<ChatSummary[]>([])
const activeChatId = ref<string | null>(null)
const chatDetail = ref<ChatDetail | null>(null)
const messages = ref<ChatMessage[]>([])
const network = ref<NetworkNode[]>([])

const chatsLoading = ref(false)
const messagesLoading = ref(false)

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

async function sendMessage(text: string): Promise<void> {
  if (!activeChatId.value) return
  const message = await api.sendMessage(activeChatId.value, text)
  messages.value = [...messages.value, message]
}

watch(activeChatId, (id) => {
  chats.value = chats.value.map((c) => ({ ...c, active: c.id === id }))
})

onMounted(loadChats)
</script>

<template>
  <div class="flex w-full h-full bg-background">
    <GlobalSidebar :active="nav" @navigate="nav = $event" />
    <ChatList
      :chats="chats"
      :active-chat-id="activeChatId"
      :loading="chatsLoading"
      @select="selectChat"
    />
    <main class="flex-1 flex flex-col h-full bg-surface min-w-0 relative">
      <ChatHeader :detail="chatDetail" />
      <MessageList :messages="messages" :loading="messagesLoading" />
      <MessageInput @send="sendMessage" />
    </main>
    <RightInspector :network="network" />
  </div>
</template>
