<script setup lang="ts">
import type { OptionsMessage } from '../../api'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

defineProps<{ message: OptionsMessage }>()
</script>

<template>
  <div class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%] w-full">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-[12px] font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-[12px] text-[#8f959e]">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface border border-surface-border p-4 rounded-[8px] rounded-tl-sm text-[14px] w-full max-w-lg shadow-card"
      >
        <p class="text-text-main mb-3 leading-[22px]">{{ message.text }}</p>
        <ul class="space-y-2">
          <li
            v-for="opt in message.options"
            :key="opt.id"
            class="flex items-center space-x-2.5 bg-[#f5f6f7] px-3 py-2.5 rounded-[6px]"
          >
            <span class="material-symbols-outlined text-primary text-[18px]">check_circle</span>
            <span class="text-[13px] text-text-main">{{ opt.label }}</span>
          </li>
          <li
            class="bg-white border border-surface-border px-3 py-2 rounded-[6px] focus-within:border-primary transition-colors"
          >
            <input
              class="w-full bg-transparent border-none p-0 text-[13px] text-text-main placeholder-[#8f959e] focus:ring-0 focus:outline-none"
              :placeholder="message.placeholder ?? '在此输入您的意见或需求...'"
              type="text"
            />
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
