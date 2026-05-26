<script setup lang="ts">
import type { SenderInfo } from '../../api'

defineProps<{ sender: SenderInfo }>()

const accentClasses: Record<NonNullable<SenderInfo['accent']>, string> = {
  primary: 'bg-primary/10 text-primary',
  violet: 'bg-[#f0f0ff] text-[#7b61ff] border border-[#e5e5ff]',
  green: 'bg-[#e8f6e8] text-[#34c759] border border-[#cdeccd]',
  neutral: 'bg-white border border-surface-border text-[#34c759]'
}
</script>

<template>
  <div
    class="w-10 h-10 rounded-[8px] flex items-center justify-center flex-shrink-0 text-[14px] font-semibold overflow-hidden"
    :class="sender.avatarDataUrl ? '' : accentClasses[sender.accent ?? 'neutral']"
  >
    <img
      v-if="sender.avatarDataUrl"
      :src="sender.avatarDataUrl"
      :alt="sender.name"
      class="w-full h-full object-cover"
    />
    <span v-else-if="sender.icon" class="material-symbols-outlined text-[20px]">
      {{ sender.icon }}
    </span>
    <span v-else>{{ sender.initials ?? sender.name.slice(0, 2).toUpperCase() }}</span>
  </div>
</template>
