<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatDisplayMessage } from '../types/chatDisplay'

const props = defineProps<{
  messages: ChatDisplayMessage[]
  toText: (msg: ChatDisplayMessage) => string
  senderName: (msg: ChatDisplayMessage) => string
}>()

const emit = defineEmits<{
  (e: 'unpin', message: ChatDisplayMessage): void
  (e: 'jump', message: ChatDisplayMessage): void
}>()

const expanded = ref(false)

const pinned = computed(() =>
  [...props.messages].filter((m) => m.pinned).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
)

const latest = computed(() => pinned.value[0] ?? null)

function excerpt(msg: ChatDisplayMessage): string {
  const text = props.toText(msg).replace(/\s+/g, ' ').trim()
  return text.length > 60 ? text.slice(0, 60) + '…' : text
}

function toggle(): void {
  if (pinned.value.length > 1) expanded.value = !expanded.value
}

function onUnpin(e: MouseEvent, msg: ChatDisplayMessage): void {
  e.stopPropagation()
  emit('unpin', msg)
}

function onJump(msg: ChatDisplayMessage): void {
  emit('jump', msg)
}
</script>

<template>
  <div v-if="latest" class="border-b border-surface-border bg-warning-soft flex-shrink-0">
    <button
      type="button"
      class="w-full flex items-center space-x-2 px-4 py-2 text-left hover:bg-warning-soft-hover transition-colors"
      :class="{ 'cursor-default hover:bg-warning-soft': pinned.length <= 1 }"
      @click="toggle"
    >
      <span class="material-symbols-outlined text-2xl text-warning">keep</span>
      <div class="flex-1 min-w-0 flex items-center space-x-2">
        <span class="text-sm font-semibold text-text-main flex-shrink-0">
          {{ senderName(latest) }}：
        </span>
        <span class="text-sm text-text-main truncate">{{ excerpt(latest) }}</span>
      </div>
      <span class="text-sm text-text-muted flex-shrink-0">
        {{ pinned.length > 1 ? `共 ${pinned.length} 条` : '' }}
      </span>
      <span
        v-if="pinned.length > 1"
        class="material-symbols-outlined text-2xl text-text-muted transition-transform"
        :class="{ 'rotate-180': expanded }"
        >expand_more</span
      >
    </button>
    <ul v-if="expanded && pinned.length > 1" class="border-t border-warning-border bg-white">
      <li
        v-for="msg in pinned"
        :key="msg.id"
        class="flex items-start space-x-2 px-4 py-2 border-b border-background last:border-b-0 hover:bg-warning-soft cursor-pointer transition-colors"
        @click="onJump(msg)"
      >
        <span class="material-symbols-outlined text-xl text-warning mt-0.5">keep</span>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-text-main">{{ senderName(msg) }}</div>
          <div class="text-sm text-text-muted line-clamp-2 break-words">
            {{ excerpt(msg) }}
          </div>
        </div>
        <button
          type="button"
          class="text-text-muted hover:text-text-main p-0.5 rounded-sm hover:bg-gray-150 transition-colors flex-shrink-0"
          title="取消Pin"
          @click="onUnpin($event, msg)"
        >
          <span class="material-symbols-outlined text-xl">keep_off</span>
        </button>
      </li>
    </ul>
  </div>
</template>
