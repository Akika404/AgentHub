<script setup lang="ts">
import type { ChatSummary } from '../api'

defineProps<{
  chats: ChatSummary[]
  activeChatId: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'search', value: string): void
}>()
</script>

<template>
  <aside
    class="w-[280px] h-full flex flex-col border-r border-surface-border bg-surface flex-shrink-0 z-10"
  >
    <div class="flex items-center space-x-2 h-16 px-4">
      <div class="relative flex-1 group">
        <span
          class="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[18px]"
        >
          search
        </span>
        <input
          class="w-full h-8 pl-8 pr-3 text-[14px] leading-none bg-[#f2f3f5] border border-transparent rounded-[6px] focus:outline-none focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-[#8f959e]"
          placeholder="搜索"
          type="text"
          @input="emit('search', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <button
        class="w-8 h-8 flex items-center justify-center bg-[#f2f3f5] rounded-[6px] hover:bg-[#e4e6ea] text-text-muted transition-colors"
        title="新建会话"
      >
        <span class="material-symbols-outlined text-[18px]">add</span>
      </button>
    </div>
    <div class="flex-1 overflow-y-auto py-1">
      <div v-if="loading" class="px-4 py-3 text-text-muted text-[13px]">加载中...</div>
      <div
        v-for="chat in chats"
        :key="chat.id"
        class="px-3 mx-2 rounded-[8px] flex items-center space-x-3 cursor-pointer transition-colors group py-2 mb-1"
        :class="chat.id === activeChatId ? 'bg-surface-active' : 'hover:bg-surface-hover'"
        @click="emit('select', chat.id)"
      >
        <div
          class="w-10 h-10 rounded-[8px] flex items-center justify-center flex-shrink-0"
          :class="
            chat.avatar.kind === 'initials'
              ? 'bg-primary/10 text-primary font-semibold text-[14px]'
              : 'bg-[#f2f3f5] text-[#8f959e]'
          "
        >
          <span v-if="chat.avatar.kind === 'initials'">{{ chat.avatar.text }}</span>
          <span v-else class="material-symbols-outlined text-[20px]">{{ chat.avatar.icon }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div
            class="font-medium truncate text-[14px]"
            :class="chat.id === activeChatId ? 'text-primary' : 'text-text-main'"
          >
            {{ chat.title }}
          </div>
          <div class="text-[#8f959e] truncate mt-0.5 text-[12px]">{{ chat.preview }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
