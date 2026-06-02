<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MessageReplyRef } from '../api'
import BaseButton from './ui/BaseButton.vue'

const props = defineProps<{
  replyTo?: MessageReplyRef | null
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'send', payload: { text: string; replyTo?: MessageReplyRef }): void
  (e: 'cancel-reply'): void
}>()

const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const isComposing = ref(false)

watch(
  () => props.replyTo,
  (v) => {
    if (v) inputRef.value?.focus()
  }
)

function submit(): void {
  if (props.disabled || isComposing.value) return
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', { text: trimmed, replyTo: props.replyTo ?? undefined })
  text.value = ''
}

function isComposingEvent(event: KeyboardEvent): boolean {
  return isComposing.value || event.isComposing || event.key === 'Process' || event.keyCode === 229
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && event.shiftKey) return

  if (event.key === 'Enter') {
    if (isComposingEvent(event)) return
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
        class="mb-2 flex items-start justify-between bg-background border-l-2 border-primary rounded px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-text-main">回复 {{ replyTo.senderName }}</div>
          <div class="text-sm text-text-muted line-clamp-2 break-words">
            {{ replyTo.excerpt }}
          </div>
        </div>
        <button
          type="button"
          class="ml-2 text-text-muted hover:text-text-main p-0.5 rounded-sm hover:bg-gray-150 transition-colors"
          @click="emit('cancel-reply')"
        >
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>
      <div class="p-1">
        <textarea
          ref="inputRef"
          v-model="text"
          :disabled="disabled"
          class="w-full h-[72px] p-0 resize-none border-none focus:ring-0 focus:outline-none text-md text-text-main placeholder-text-muted bg-transparent leading-[22px]"
          placeholder="Type a message or /command..."
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
          @keydown="onKey"
        />
      </div>
      <div class="flex items-center justify-between py-2">
        <div class="flex items-center space-x-2 text-text-muted">
          <BaseButton variant="ghost" icon>
            <span class="material-symbols-outlined text-3xl">attach_file</span>
          </BaseButton>
          <BaseButton variant="ghost" icon>
            <span class="material-symbols-outlined text-3xl">code</span>
          </BaseButton>
        </div>
        <button
          class="bg-primary text-white px-5 py-1.5 rounded text-base font-medium flex items-center space-x-1.5 hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="disabled || isComposing || !text.trim()"
          @click="submit"
        >
          <span>发送&nbsp;</span>
          <span class="material-symbols-outlined text-xl">send</span>
        </button>
      </div>
    </div>
  </div>
</template>
