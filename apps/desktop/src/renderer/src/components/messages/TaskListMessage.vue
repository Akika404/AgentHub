<script setup lang="ts">
import type { TaskListMessage } from '../../api'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

defineProps<{ message: TaskListMessage }>()
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
        class="bg-surface border border-surface-border p-4 rounded-[8px] rounded-tl-sm text-[14px] w-full max-w-md shadow-card"
      >
        <div class="font-semibold text-text-main mb-3 text-[14px]">{{ message.heading }}</div>
        <ul class="space-y-1.5">
          <li
            v-for="task in message.tasks"
            :key="task.id"
            class="flex items-center space-x-2 text-text-main bg-white border border-surface-border rounded-[8px] px-3 py-1.5"
          >
            <span
              v-if="task.status === 'in-progress'"
              class="w-[18px] h-[18px] rounded-full border-[2px] border-primary flex items-center justify-center bg-white"
            >
              <span class="w-[8px] h-[8px] bg-primary rounded-full"></span>
            </span>
            <span
              v-else-if="task.status === 'done'"
              class="w-[18px] h-[18px] rounded-full bg-primary flex items-center justify-center text-white"
            >
              <span class="material-symbols-outlined text-[14px]">check</span>
            </span>
            <span
              v-else
              class="w-[18px] h-[18px] rounded-full border-[2px] border-[#dee0e3] bg-white flex items-center justify-center"
            ></span>
            <span class="text-[14px]">{{ task.title }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
