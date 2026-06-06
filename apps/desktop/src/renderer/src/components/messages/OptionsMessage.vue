<script setup lang="ts">
import { ref } from 'vue'
import type { OptionItem, OptionsMessage } from '../../api'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: OptionsMessage }>()

const emit = defineEmits<{
  (e: 'select', payload: { message: OptionsMessage; option: OptionItem }): void
  (e: 'reply', payload: { message: OptionsMessage; text: string }): void
}>()

const draft = ref('')
const isComposing = ref(false)

function onSelect(option: OptionItem): void {
  if (props.message.answered) return
  emit('select', { message: props.message, option })
}

function submitDraft(): void {
  if (props.message.answered || isComposing.value) return
  const text = draft.value.trim()
  if (!text) return
  emit('reply', { message: props.message, text })
  draft.value = ''
}

function isComposingEvent(event: KeyboardEvent): boolean {
  return isComposing.value || event.isComposing || event.key === 'Process' || event.keyCode === 229
}

function onInputKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    if (isComposingEvent(event)) return
    event.preventDefault()
    submitDraft()
  }
}
</script>

<template>
  <div class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%] w-full">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-sm font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-sm text-text-muted">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface border border-surface-border p-4 rounded-xl rounded-tl-sm text-md w-full max-w-lg shadow-sm"
      >
        <p class="text-text-main mb-3 leading-[22px]">{{ message.text }}</p>
        <ul class="space-y-2">
          <li v-for="opt in message.options" :key="opt.id">
            <button
              type="button"
              :disabled="message.answered"
              :class="[
                'w-full flex items-center space-x-2.5 px-3 py-2.5 rounded text-left transition-colors group',
                message.answered
                  ? message.answeredOptionId === opt.id
                    ? 'bg-primary-soft border border-primary/40 cursor-default'
                    : 'bg-background opacity-60 cursor-not-allowed'
                  : 'bg-background hover:bg-primary-soft active:bg-primary-softer cursor-pointer'
              ]"
              @click="onSelect(opt)"
            >
              <span
                class="material-symbols-outlined text-primary text-2xl transition-transform"
                :class="{ 'group-hover:scale-110': !message.answered }"
                >check_circle</span
              >
              <span class="text-base text-text-main flex-1">{{ opt.label }}</span>
              <span
                v-if="!message.answered"
                class="material-symbols-outlined text-xl text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                >send</span
              >
              <span
                v-else-if="message.answeredOptionId === opt.id"
                class="material-symbols-outlined text-xl text-primary"
                >done</span
              >
            </button>
          </li>
          <li
            v-if="!message.answered"
            class="flex items-center space-x-2 bg-white border border-surface-border px-3 py-2 rounded focus-within:border-primary transition-colors"
          >
            <input
              v-model="draft"
              class="flex-1 bg-transparent border-none p-0 text-base text-text-main placeholder-text-muted focus:ring-0 focus:outline-none"
              :placeholder="message.placeholder ?? '在此输入您的意见或需求...'"
              type="text"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @keydown="onInputKey"
            />
            <button
              type="button"
              :disabled="isComposing || !draft.trim()"
              class="flex items-center justify-center w-6 h-6 rounded-sm text-primary hover:bg-primary-soft disabled:text-gray-400 disabled:hover:bg-transparent transition-colors"
              @click="submitDraft"
            >
              <span class="material-symbols-outlined text-2xl">send</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
