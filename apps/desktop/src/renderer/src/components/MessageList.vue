<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { AgentQuestionMessage, BlackboardArtifact, OptionItem, OptionsMessage } from '../api'
import {
  isAgentRunMessage,
  isDeployMessage,
  type ChatDisplayMessage,
  type DeployMessage
} from '../types/chatDisplay'
import type { MentionTarget } from '../types/mentions'
import SystemMessageView from './messages/SystemMessage.vue'
import TextMessageView from './messages/TextMessage.vue'
import TaskListMessageView from './messages/TaskListMessage.vue'
import OptionsMessageView from './messages/OptionsMessage.vue'
import AgentQuestionMessageView from './messages/AgentQuestionMessage.vue'
import AgentRunMessageView from './messages/AgentRunMessage.vue'
import DeployMessageView from './messages/DeployMessage.vue'
import ContextMenu, { type MenuItem } from './ContextMenu.vue'
import BaseSkeleton from './ui/BaseSkeleton.vue'

const props = defineProps<{
  messages: ChatDisplayMessage[]
  loading?: boolean
  mentionTargets?: MentionTarget[]
  mentionDisabled?: boolean
  interactionDisabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-option', payload: { message: OptionsMessage; option: OptionItem }): void
  (e: 'reply-option', payload: { message: OptionsMessage; text: string }): void
  (
    e: 'submit-question',
    payload: { message: AgentQuestionMessage; text: string; mentions: string[] }
  ): void
  (e: 'pin-message', message: ChatDisplayMessage): void
  (e: 'copy-message', message: ChatDisplayMessage): void
  (e: 'reply-message', message: ChatDisplayMessage): void
  (e: 'mention-sender', senderId: string): void
  (e: 'preview-artifact', artifact: BlackboardArtifact): void
  (e: 'edit-artifact', artifact: BlackboardArtifact): void
  (e: 'run-deployment', message: DeployMessage): void
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

function onItemPointerDown(event: PointerEvent, message: ChatDisplayMessage): void {
  if ((event.target as HTMLElement)?.closest('button, a, input, textarea')) return
  activeId.value = message.id
}

function onItemPointerUpOrLeave(id: string): void {
  if (activeId.value === id) activeId.value = null
}

defineExpose({ scrollToMessage })

const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref<ChatDisplayMessage | null>(null)
const menuItems = ref<MenuItem[]>([])

function senderIdFor(message: ChatDisplayMessage): string | null {
  return 'sender' in message ? message.sender.id : null
}

function mentionTargetFor(message: ChatDisplayMessage): MentionTarget | null {
  const senderId = senderIdFor(message)
  if (!senderId) return null
  return props.mentionTargets?.find((target) => target.id === senderId) ?? null
}

function openMenu(event: MouseEvent, message: ChatDisplayMessage): void {
  event.preventDefault()
  menuTarget.value = message
  menuX.value = event.clientX
  menuY.value = event.clientY
  const mentionTarget = mentionTargetFor(message)
  menuItems.value = [
    ...(mentionTarget
      ? [
          {
            id: 'mention',
            label: `@${mentionTarget.label}`,
            icon: 'alternate_email',
            disabled: props.mentionDisabled || props.interactionDisabled
          }
        ]
      : []),
    {
      id: 'pin',
      label: message.pinned ? '取消Pin' : 'Pin消息',
      icon: message.pinned ? 'keep_off' : 'keep'
    },
    { id: 'copy', label: '复制', icon: 'content_copy' },
    { id: 'reply', label: '回复', icon: 'reply', disabled: props.interactionDisabled }
  ]
  menuOpen.value = true
}

function openMessageMenu(event: MouseEvent, message: ChatDisplayMessage): void {
  event.preventDefault()
  openMenu(event, message)
}

function isPinnedMessage(message: ChatDisplayMessage): boolean {
  return Boolean(message.pinned)
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
  else if (id === 'mention') {
    const senderId = senderIdFor(target)
    if (senderId) emit('mention-sender', senderId)
  }
}

function scrollSignature(): string {
  const last = props.messages[props.messages.length - 1]
  if (!last) return '0'
  if (isAgentRunMessage(last)) {
    return `${props.messages.length}:${last.id}:${last.status}:${last.steps.length}:${last.text.length}`
  }
  if (last.kind === 'text') return `${props.messages.length}:${last.id}:${last.text.length}`
  return `${props.messages.length}:${last.id}:${last.kind}`
}

watch(scrollSignature, async () => {
  await nextTick()
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
})
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
          'relative group rounded-lg -mx-4 px-4 py-3 transition-all duration-150',
          isPinnedMessage(msg) ? 'border-l-2 border-warning bg-warning-soft/40 pl-5 -ml-5' : '',
          highlightId === msg.id ? 'ring-2 ring-primary/40' : '',
          'cursor-pointer hover:bg-background/60',
          activeId === msg.id ? 'bg-primary-soft/60 scale-[0.995]' : ''
        ]"
        @contextmenu="openMessageMenu($event, msg)"
        @pointerdown="onItemPointerDown($event, msg)"
        @pointerup="onItemPointerUpOrLeave(msg.id)"
        @pointerleave="onItemPointerUpOrLeave(msg.id)"
        @pointercancel="onItemPointerUpOrLeave(msg.id)"
      >
        <span
          v-if="isPinnedMessage(msg)"
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
          :disabled="interactionDisabled"
          @select="emit('select-option', $event)"
          @reply="emit('reply-option', $event)"
        />
        <AgentQuestionMessageView
          v-else-if="msg.kind === 'agent-question'"
          :message="msg"
          :disabled="interactionDisabled"
          @submit="emit('submit-question', $event)"
        />
        <AgentRunMessageView
          v-else-if="isAgentRunMessage(msg)"
          :message="msg"
          @preview-artifact="emit('preview-artifact', $event)"
          @edit-artifact="emit('edit-artifact', $event)"
        />
        <DeployMessageView
          v-else-if="isDeployMessage(msg)"
          :message="msg"
          @preview-artifact="emit('preview-artifact', $event)"
          @edit-artifact="emit('edit-artifact', $event)"
          @run-deployment="emit('run-deployment', $event)"
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
