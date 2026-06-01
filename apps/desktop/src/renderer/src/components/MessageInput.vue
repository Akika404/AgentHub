<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MessageReplyRef } from '../api'

const props = defineProps<{
  replyTo?: MessageReplyRef | null
}>()

const emit = defineEmits<{
  (e: 'send', payload: { text: string; replyTo?: MessageReplyRef }): void
  (e: 'cancel-reply'): void
}>()

const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)

watch(
  () => props.replyTo,
  (v) => {
    if (v) inputRef.value?.focus()
  }
)

function submit(): void {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', { text: trimmed, replyTo: props.replyTo ?? undefined })
  text.value = ''
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  } else if (event.key === 'Escape' && props.replyTo) {
    event.preventDefault()
    emit('cancel-reply')
  }
}
</script>

<template>
  <div class="p-4 border-t border-surface-border bg-surface flex-shrink-0">
    <div class="flex flex-col">
      <div
        v-if="replyTo"
        class="mb-2 flex items-start justify-between bg-background border-l-2 border-primary rounded-[6px] px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-semibold text-text-main">回复 {{ replyTo.senderName }}</div>
          <div class="text-[12px] text-text-muted line-clamp-2 break-words">
            {{ replyTo.excerpt }}
          </div>
        </div>
        <button
          type="button"
          class="ml-2 text-text-muted hover:text-text-main p-0.5 rounded-[4px] hover:bg-gray-150 transition-colors"
          @click="emit('cancel-reply')"
        >
          <span class="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div class="p-1">
        <textarea
          ref="inputRef"
          v-model="text"
          class="w-full h-[72px] p-0 resize-none border-none focus:ring-0 focus:outline-none text-[14px] text-text-main placeholder-text-muted bg-transparent leading-[22px]"
          placeholder="Type a message or /command..."
          @keydown="onKey"
        />
      </div>
      <div class="flex items-center justify-between py-2">
        <div class="flex items-center space-x-2 text-text-muted">
          <button
            class="hover:text-text-main hover:bg-surface-hover p-1.5 rounded-[6px] transition-colors flex items-center"
          >
            <span class="material-symbols-outlined text-[20px]">attach_file</span>
          </button>
          <button
            class="hover:text-text-main hover:bg-surface-hover p-1.5 rounded-[6px] transition-colors flex items-center"
          >
            <span class="material-symbols-outlined text-[20px]">code</span>
          </button>
        </div>
        <button
          class="bg-primary text-white px-5 py-1.5 rounded-[6px] text-[13px] font-medium flex items-center space-x-1.5 hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="!text.trim()"
          @click="submit"
        >
          <span>发送&nbsp;</span>
          <span class="material-symbols-outlined text-[16px]">send</span>
        </button>
      </div>
    </div>
  </div>
</template>
