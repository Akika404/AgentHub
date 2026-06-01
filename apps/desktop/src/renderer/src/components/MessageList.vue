<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage, OptionItem, OptionsMessage } from '../api'
import SystemMessageView from './messages/SystemMessage.vue'
import TextMessageView from './messages/TextMessage.vue'
import TaskListMessageView from './messages/TaskListMessage.vue'
import OptionsMessageView from './messages/OptionsMessage.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import BaseSkeleton from './ui/BaseSkeleton.vue'

const props = defineProps<{
  messages: ChatMessage[]
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-option', payload: { message: OptionsMessage; option: OptionItem }): void
  (e: 'reply-option', payload: { message: OptionsMessage; text: string }): void
  (e: 'pin-message', message: ChatMessage): void
  (e: 'copy-message', message: ChatMessage): void
  (e: 'reply-message', message: ChatMessage): void
}>()

const scrollRef = ref<HTMLElement | null>(null)
const itemRefs = new Map<string, HTMLElement>()
const highlightId = ref<string | null>(null)
const activeId = ref<string | null>(null)

function setItemRef(id: string, el: Element | null): void {
  if (el instanceof HTMLElement) itemRefs.set(id, el)
  else itemRefs.delete(id)
}

function scrollToMessage(id: string): void {
  const el = itemRefs.get(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  highlightId.value = id
  window.setTimeout(() => {
    if (highlightId.value === id) highlightId.value = null
  }, 1600)
}

function onItemPointerDown(event: PointerEvent, id: string): void {
  if ((event.target as HTMLElement)?.closest('button, a, input, textarea')) return
  activeId.value = id
}

function onItemPointerUpOrLeave(id: string): void {
  if (activeId.value === id) activeId.value = null
}

defineExpose({ scrollToMessage })

const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref<ChatMessage | null>(null)
const menuItems = ref<MenuItem[]>([])

function openMenu(event: MouseEvent, message: ChatMessage): void {
  event.preventDefault()
  menuTarget.value = message
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuItems.value = [
    {
      id: 'pin',
      label: message.pinned ? '取消Pin' : 'Pin消息',
      icon: message.pinned ? 'keep_off' : 'keep'
    },
    { id: 'copy', label: '复制', icon: 'content_copy' },
    { id: 'reply', label: '回复', icon: 'reply' }
  ]
  menuOpen.value = true
}

function closeMenu(): void {
  menuOpen.value = false
  menuTarget.value = null
}

function onMenuSelect(id: string): void {
  const target = menuTarget.value
  if (!target) return
  if (id === 'pin') emit('pin-message', target)
  else if (id === 'copy') emit('copy-message', target)
  else if (id === 'reply') emit('reply-message', target)
}

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
    <div v-if="loading" class="space-y-6">
      <div v-for="i in 4" :key="i" class="flex space-x-3">
        <BaseSkeleton class="w-9 h-9 flex-shrink-0" />
        <div class="flex-1 space-y-2 max-w-[60%]">
          <BaseSkeleton class="h-3 w-24" />
          <BaseSkeleton class="h-12 w-full" />
        </div>
      </div>
    </div>
    <template v-for="msg in messages" :key="msg.id">
      <div
        :ref="(el) => setItemRef(msg.id, el as Element | null)"
        :class="[
          'relative group rounded-lg -mx-4 px-4 py-3 transition-all duration-150 cursor-pointer',
          msg.pinned ? 'border-l-2 border-warning bg-warning-soft/40 pl-5 -ml-5' : '',
          highlightId === msg.id ? 'ring-2 ring-primary/40' : '',
          activeId === msg.id ? 'bg-primary-soft/60 scale-[0.995]' : 'hover:bg-background/60'
        ]"
        @contextmenu="openMenu($event, msg)"
        @pointerdown="onItemPointerDown($event, msg.id)"
        @pointerup="onItemPointerUpOrLeave(msg.id)"
        @pointerleave="onItemPointerUpOrLeave(msg.id)"
        @pointercancel="onItemPointerUpOrLeave(msg.id)"
      >
        <span
          v-if="msg.pinned"
          class="absolute -left-1 top-0 material-symbols-outlined text-md text-warning"
          title="已Pin"
          >keep</span
        >
        <SystemMessageView v-if="msg.kind === 'system'" :message="msg" />
        <TextMessageView v-else-if="msg.kind === 'text'" :message="msg" />
        <TaskListMessageView v-else-if="msg.kind === 'task-list'" :message="msg" />
        <OptionsMessageView
          v-else-if="msg.kind === 'options'"
          :message="msg"
          @select="emit('select-option', $event)"
          @reply="emit('reply-option', $event)"
        />
      </div>
    </template>
    <ContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeMenu"
    />
  </div>
</template>
