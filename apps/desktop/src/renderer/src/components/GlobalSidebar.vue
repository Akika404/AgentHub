<script setup lang="ts">
import { ref } from 'vue'
import type { CurrentUser } from '../api'

type NavKey = 'chat' | 'agents' | 'settings'

defineProps<{ active: NavKey; user: CurrentUser | null }>()
const emit = defineEmits<{
  (e: 'navigate', key: NavKey): void
  (e: 'avatar-selected', dataUrl: string): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function pickAvatar(): void {
  fileInput.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    const result = reader.result
    if (typeof result === 'string') emit('avatar-selected', result)
  }
  reader.readAsDataURL(file)
}
</script>

<template>
  <aside
    class="w-[68px] h-full flex flex-col items-center py-4 border-r border-surface-border bg-[#f2f3f5] flex-shrink-0 z-20"
  >
    <div class="flex-1 flex flex-col items-center space-y-4 w-full">
      <div class="flex items-center justify-center w-full mb-4">
        <button
          type="button"
          class="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-white font-semibold text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
          :class="
            user?.avatarDataUrl
              ? 'bg-surface-hover'
              : 'bg-gradient-to-br from-primary to-[#7b61ff]'
          "
          :title="user ? `更换 ${user.name} 的头像` : '更换头像'"
          @click="pickAvatar"
        >
          <img
            v-if="user?.avatarDataUrl"
            :src="user.avatarDataUrl"
            :alt="user.name"
            class="w-full h-full object-cover"
          />
          <span v-else>{{ user?.initials?.charAt(0) ?? 'U' }}</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="hidden"
          @change="onFileChange"
        />
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
