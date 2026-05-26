<script setup lang="ts">
import type { TextMessage } from '../../api'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: TextMessage }>()

const isSelf = (): boolean =>
  props.message.sender.role === 'user' && props.message.sender.id === 'me'
</script>

<template>
  <div v-if="isSelf()" class="flex justify-end space-x-3">
    <div class="flex flex-col items-end max-w-[70%]">
      <div
        class="bg-primary text-white p-3 rounded-[8px] rounded-tr-sm text-[14px] leading-[22px] whitespace-pre-wrap break-words"
      >
        {{ message.text }}
      </div>
      <span class="text-[12px] text-[#8f959e] mt-1">{{ formatTime(message.timestamp) }}</span>
    </div>
    <SenderAvatar :sender="message.sender" />
  </div>
  <div v-else class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%]">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-[12px] font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-[12px] text-[#8f959e]">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-[#f2f3f5] p-3 rounded-[8px] rounded-tl-sm text-[14px] leading-[22px] whitespace-pre-wrap break-words"
      >
        {{ message.text }}
      </div>
    </div>
  </div>
</template>
