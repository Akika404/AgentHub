<script setup lang="ts">
import type { UserView } from '@agenthub/shared'
import UserMenu from './UserMenu.vue'

type NavKey = 'chat' | 'groups' | 'agents' | 'settings'

defineProps<{ active: NavKey; user: UserView | null }>()
const emit = defineEmits<{
  (e: 'navigate', key: NavKey): void
}>()
</script>

<template>
  <aside
    class="w-[68px] h-full flex flex-col items-center py-4 border-r border-surface-border bg-surface-hover flex-shrink-0 z-20"
  >
    <div class="flex-1 flex flex-col items-center space-y-4 w-full">
      <div class="flex items-center justify-center w-full mb-4">
        <UserMenu :user="user" />
      </div>
      <button
        class="w-12 flex flex-col items-center justify-center rounded-md group transition-all h-10"
        :class="
          active === 'chat'
            ? 'bg-surface-active text-primary'
            : 'text-gray-600 hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'chat')"
      >
        <span class="material-symbols-outlined text-4xl">chat_bubble</span>
      </button>
      <button
        class="w-12 flex flex-col items-center justify-center rounded-md group transition-all h-10"
        :class="
          active === 'groups'
            ? 'bg-surface-active text-primary'
            : 'text-gray-600 hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'groups')"
      >
        <span class="material-symbols-outlined text-4xl">groups</span>
      </button>
      <button
        class="w-12 flex flex-col items-center justify-center rounded-md group transition-all h-10"
        :class="
          active === 'agents'
            ? 'bg-surface-active text-primary'
            : 'text-gray-600 hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'agents')"
      >
        <span class="material-symbols-outlined text-4xl">smart_toy</span>
      </button>
    </div>
    <div class="mt-auto flex flex-col items-center w-full">
      <button
        class="w-12 flex flex-col items-center justify-center rounded-md group transition-all h-10"
        :class="
          active === 'settings'
            ? 'bg-surface-active text-primary'
            : 'text-gray-600 hover:bg-surface-hover hover:text-text-main'
        "
        @click="emit('navigate', 'settings')"
      >
        <span class="material-symbols-outlined text-4xl">settings</span>
      </button>
    </div>
  </aside>
</template>
