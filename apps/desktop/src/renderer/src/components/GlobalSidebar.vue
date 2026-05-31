<script setup lang="ts">
import type { UserView } from '@agenthub/shared'
import UserMenu from './UserMenu.vue'

type NavKey = 'chat' | 'agents' | 'settings'

defineProps<{ active: NavKey; user: UserView | null }>()
const emit = defineEmits<{
  (e: 'navigate', key: NavKey): void
}>()
</script>

<template>
  <aside
    class="w-[68px] h-full flex flex-col items-center py-4 border-r border-surface-border bg-[#f2f3f5] flex-shrink-0 z-20"
  >
    <div class="flex-1 flex flex-col items-center space-y-4 w-full">
      <div class="flex items-center justify-center w-full mb-4">
        <UserMenu :user="user" />
      </div>
      <button
        class="w-12 flex flex-col items-center justify-center rounded-xl group transition-all h-10"
        :class="
          active === 'chat'
            ? 'bg-surface-active text-primary'
            : 'text-text-muted hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'chat')"
      >
        <span class="material-symbols-outlined text-[24px]">chat_bubble</span>
      </button>
      <button
        class="w-12 flex flex-col items-center justify-center rounded-xl group transition-all h-10"
        :class="
          active === 'agents'
            ? 'bg-surface-active text-primary'
            : 'text-text-muted hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'agents')"
      >
        <span class="material-symbols-outlined text-[24px]">smart_toy</span>
      </button>
    </div>
    <div class="mt-auto flex flex-col items-center w-full">
      <button
        class="w-12 flex flex-col items-center justify-center rounded-xl group transition-all h-10"
        :class="
          active === 'settings'
            ? 'bg-surface-active text-primary'
            : 'text-text-muted hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'settings')"
      >
        <span class="material-symbols-outlined text-[24px]">settings</span>
      </button>
    </div>
  </aside>
</template>
