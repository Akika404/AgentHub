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
  return text.length > 96 ? text.slice(0, 96) + '…' : text
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function onPrimaryClick(): void {
  if (pinned.value.length > 1) {
    expanded.value = !expanded.value
    return
  }

  if (latest.value) emit('jump', latest.value)
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
  <div v-if="latest" class="flex-shrink-0 border-b border-surface-border bg-surface px-3 py-2">
    <button
      type="button"
      class="group relative flex w-full items-center gap-3 overflow-hidden rounded-md border border-warning-border/80 bg-gradient-to-r from-warning-soft via-white to-white px-3 py-2 text-left shadow-sm transition-all duration-200 ease-soft hover:border-warning hover:shadow-md"
      @click="onPrimaryClick"
    >
      <span class="absolute left-0 top-0 h-full w-1 bg-warning" aria-hidden="true"></span>
      <span
        class="material-symbols-outlined flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-white text-xl text-warning shadow-sm ring-1 ring-warning-border/80"
        >keep</span
      >
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="flex-shrink-0 text-sm font-semibold text-text-main">
            {{ senderName(latest) }}
          </span>
          <span class="text-xs text-text-muted">{{ formatTime(latest.timestamp) }}</span>
        </div>
        <div class="mt-0.5 truncate text-sm leading-5 text-text-main">
          {{ excerpt(latest) }}
        </div>
      </div>
      <span
        v-if="pinned.length > 1"
        class="flex-shrink-0 rounded-full border border-warning-border bg-white/80 px-2 py-0.5 text-xs font-medium text-text-main"
      >
        {{ pinned.length }} 条
      </span>
      <span
        v-if="pinned.length > 1"
        class="material-symbols-outlined flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-xl text-text-muted transition-transform duration-200 ease-soft group-hover:bg-warning-soft"
        :class="{ 'rotate-180': expanded }"
        >expand_more</span
      >
    </button>

    <ul
      v-if="expanded && pinned.length > 1"
      class="mt-2 overflow-hidden rounded-md border border-surface-border bg-white shadow-sm"
    >
      <li
        v-for="msg in pinned"
        :key="msg.id"
        class="grid cursor-pointer grid-cols-[auto,minmax(0,1fr),auto] items-start gap-3 border-b border-background px-3 py-2.5 transition-colors last:border-b-0 hover:bg-surface-hover"
        @click="onJump(msg)"
      >
        <span
          class="material-symbols-outlined mt-0.5 flex h-7 w-7 items-center justify-center rounded-md bg-warning-soft text-lg text-warning"
          >keep</span
        >
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate text-sm font-semibold text-text-main">{{ senderName(msg) }}</span>
            <span class="flex-shrink-0 text-xs text-text-muted">{{ formatTime(msg.timestamp) }}</span>
          </div>
          <div class="mt-1 line-clamp-2 break-words text-sm leading-5 text-text-muted">
            {{ excerpt(msg) }}
          </div>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-gray-150 hover:text-text-main"
          title="取消Pin"
          @click="onUnpin($event, msg)"
        >
          <span class="material-symbols-outlined text-lg">keep_off</span>
        </button>
      </li>
    </ul>
  </div>
</template>
