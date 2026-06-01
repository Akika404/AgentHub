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

function onSelect(option: OptionItem): void {
  if (props.message.answered) return
  emit('select', { message: props.message, option })
}

function submitDraft(): void {
  if (props.message.answered) return
  const text = draft.value.trim()
  if (!text) return
  emit('reply', { message: props.message, text })
  draft.value = ''
}

function onInputKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
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
        <span class="text-[12px] font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-[12px] text-text-muted">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface border border-surface-border p-4 rounded-[8px] rounded-tl-sm text-[14px] w-full max-w-lg shadow-card"
      >
        <p class="text-text-main mb-3 leading-[22px]">{{ message.text }}</p>
        <ul class="space-y-2">
          <li v-for="opt in message.options" :key="opt.id">
            <button
              type="button"
              :disabled="message.answered"
              :class="[
                'w-full flex items-center space-x-2.5 px-3 py-2.5 rounded-[6px] text-left transition-colors group',
                message.answered
                  ? message.answeredOptionId === opt.id
                    ? 'bg-primary-soft border border-primary/40 cursor-default'
                    : 'bg-background opacity-60 cursor-not-allowed'
                  : 'bg-background hover:bg-primary-soft active:bg-primary-softer cursor-pointer'
              ]"
              @click="onSelect(opt)"
            >
              <span
                class="material-symbols-outlined text-primary text-[18px] transition-transform"
                :class="{ 'group-hover:scale-110': !message.answered }"
                >check_circle</span
              >
              <span class="text-[13px] text-text-main flex-1">{{ opt.label }}</span>
              <span
                v-if="!message.answered"
                class="material-symbols-outlined text-[16px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
                >send</span
              >
              <span
                v-else-if="message.answeredOptionId === opt.id"
                class="material-symbols-outlined text-[16px] text-primary"
                >done</span
              >
            </button>
          </li>
          <li
            v-if="!message.answered"
            class="flex items-center space-x-2 bg-white border border-surface-border px-3 py-2 rounded-[6px] focus-within:border-primary transition-colors"
          >
            <input
              v-model="draft"
              class="flex-1 bg-transparent border-none p-0 text-[13px] text-text-main placeholder-text-muted focus:ring-0 focus:outline-none"
              :placeholder="message.placeholder ?? '在此输入您的意见或需求...'"
              type="text"
              @keydown="onInputKey"
            />
            <button
              type="button"
              :disabled="!draft.trim()"
              class="flex items-center justify-center w-6 h-6 rounded-[4px] text-primary hover:bg-primary-soft disabled:text-gray-400 disabled:hover:bg-transparent transition-colors"
              @click="submitDraft"
            >
              <span class="material-symbols-outlined text-[18px]">send</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
