<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ChatSummary, GroupMemberView } from '../api'
import { avatarTextColor } from '../utils/avatar'
import { formatTime } from '../utils/format'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import GroupAvatar from './GroupAvatar.vue'
import BaseSkeleton from './ui/BaseSkeleton.vue'

type ChatListItem = ChatSummary & {
  pinned: boolean
  running?: boolean
  updatedAt?: string
  groupMembers?: GroupMemberView[]
}

defineProps<{
  chats: ChatListItem[]
  activeChatId: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'search', value: string): void
  (e: 'create-chat'): void
  (e: 'create-group-chat'): void
  (e: 'toggle-pin', chat: ChatListItem): void
  (e: 'delete-chat', chat: ChatListItem): void
}>()

const createMenuOpen = ref(false)
const chatMenuOpen = ref(false)
const chatMenuX = ref(0)
const chatMenuY = ref(0)
const chatMenuTarget = ref<ChatListItem | null>(null)

const chatMenuItems = computed<MenuItem[]>(() => {
  const chat = chatMenuTarget.value
  return [
    {
      id: 'toggle-pin',
      label: chat?.pinned ? '取消置顶' : '置顶聊天',
      icon: chat?.pinned ? 'keep_off' : 'keep'
    },
    { id: 'delete', label: '删除聊天', icon: 'delete' }
  ]
})

function toggleCreateMenu(): void {
  createMenuOpen.value = !createMenuOpen.value
}

function onCreateChat(): void {
  createMenuOpen.value = false
  emit('create-chat')
}

function onCreateGroupChat(): void {
  createMenuOpen.value = false
  emit('create-group-chat')
}

function openChatMenu(event: MouseEvent, chat: ChatListItem): void {
  event.preventDefault()
  createMenuOpen.value = false
  chatMenuTarget.value = chat
  chatMenuX.value = event.clientX
  chatMenuY.value = event.clientY
  chatMenuOpen.value = true
}

function closeChatMenu(): void {
  chatMenuOpen.value = false
  chatMenuTarget.value = null
}

function onChatMenuSelect(id: string): void {
  const chat = chatMenuTarget.value
  if (!chat) return
  if (id === 'toggle-pin') emit('toggle-pin', chat)
  else if (id === 'delete') emit('delete-chat', chat)
}

function onGlobalMouseDown(event: MouseEvent): void {
  if (!createMenuOpen.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('[data-create-chat-menu]')) return
  createMenuOpen.value = false
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    createMenuOpen.value = false
    closeChatMenu()
  }
}

onMounted(() => {
  window.addEventListener('mousedown', onGlobalMouseDown, true)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onGlobalMouseDown, true)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <aside
    class="w-[280px] h-full flex flex-col border-r border-surface-border bg-surface flex-shrink-0 z-10"
  >
    <div class="flex items-center space-x-2 h-16 px-4">
      <div class="relative flex-1 group">
        <span
          class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-2xl"
        >
          search
        </span>
        <input
          class="w-full h-8 pl-8 pr-3 text-md leading-none bg-surface-hover border border-transparent rounded focus:outline-none focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-text-muted"
          placeholder="搜索"
          type="text"
          @input="emit('search', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="relative" data-create-chat-menu>
        <button
          class="w-8 h-8 flex items-center justify-center bg-surface-hover rounded hover:bg-gray-200 text-text-muted transition-colors"
          title="新建会话"
          type="button"
          @click.stop="toggleCreateMenu"
        >
          <span class="material-symbols-outlined text-2xl">add</span>
        </button>
        <Transition name="pop">
          <div
            v-if="createMenuOpen"
            class="absolute right-0 top-10 z-30 w-[156px] rounded-md border border-gray-150 bg-white py-1 shadow-lg"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-md font-medium text-text-main hover:bg-surface-hover transition-colors"
              @click="onCreateChat"
            >
              <span class="material-symbols-outlined text-2xl text-text-main">chat</span>
              <span>创建聊天</span>
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-md font-medium text-text-main hover:bg-surface-hover transition-colors"
              @click="onCreateGroupChat"
            >
              <span class="material-symbols-outlined text-2xl text-text-main">groups</span>
              <span>创建群聊</span>
            </button>
          </div>
        </Transition>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      <div v-if="loading">
        <div v-for="i in 6" :key="i" class="px-3 mx-2 py-2 flex items-center space-x-3">
          <BaseSkeleton class="w-10 h-10 flex-shrink-0" />
          <div class="flex-1 space-y-2">
            <BaseSkeleton class="h-3 w-1/2" />
            <BaseSkeleton class="h-3 w-3/4" />
          </div>
        </div>
      </div>
      <div
        v-for="chat in chats"
        :key="chat.id"
        class="px-3 mx-2 rounded-md flex items-center space-x-3 cursor-pointer transition-colors group py-2.5 mb-1 select-none"
        :class="chat.id === activeChatId ? 'bg-surface-active' : 'hover:bg-surface-hover'"
        @click="emit('select', chat.id)"
        @contextmenu="openChatMenu($event, chat)"
      >
        <div class="relative flex-shrink-0">
          <GroupAvatar
            v-if="chat.kind === 'group'"
            :members="chat.groupMembers ?? []"
            :title="chat.title"
          />
          <div
            v-else
            class="w-10 h-10 rounded-md flex items-center justify-center overflow-hidden"
            :class="
              chat.avatar.avatarDataUrl
                ? ''
                : chat.avatar.kind === 'initials'
                  ? 'bg-primary/10 text-primary font-semibold text-md'
                  : 'bg-surface-hover text-text-muted'
            "
            :style="
              !chat.avatar.avatarDataUrl && chat.avatar.kind === 'initials' && chat.avatar.color
                ? {
                    backgroundColor: chat.avatar.color,
                    color: avatarTextColor(chat.avatar.color)
                  }
                : undefined
            "
          >
            <img
              v-if="chat.avatar.avatarDataUrl"
              :src="chat.avatar.avatarDataUrl"
              :alt="chat.title"
              class="h-full w-full object-cover"
            />
            <span v-else-if="chat.avatar.kind === 'initials'">{{ chat.avatar.text }}</span>
            <span v-else class="material-symbols-outlined text-3xl">{{ chat.avatar.icon }}</span>
          </div>
          <span
            v-if="chat.running"
            class="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-surface bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
            title="正在运行"
          >
            <span
              class="block h-full w-full rounded-full bg-emerald-400 animate-ping opacity-60"
            ></span>
          </span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <div class="flex-1 min-w-0 font-medium truncate text-md text-text-main">
              {{ chat.title }}
            </div>
            <span
              v-if="chat.kind === 'group'"
              class="flex-shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary"
            >
              群聊
            </span>
            <span
              v-if="chat.pinned"
              class="material-symbols-outlined text-[18px] leading-none text-primary flex-shrink-0"
              title="已置顶"
            >
              keep
            </span>
            <span v-if="chat.updatedAt" class="flex-shrink-0 text-xs text-text-muted">
              {{ formatTime(chat.updatedAt) }}
            </span>
          </div>
          <div class="text-text-muted truncate mt-1 text-sm leading-4">{{ chat.preview }}</div>
        </div>
      </div>
    </div>
    <ContextMenu
      :open="chatMenuOpen"
      :x="chatMenuX"
      :y="chatMenuY"
      :items="chatMenuItems"
      @close="closeChatMenu"
      @select="onChatMenuSelect"
    />
  </aside>
</template>
