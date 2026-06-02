<script setup lang="ts">
import type { SenderInfo } from '../../api'
import { avatarTextColor } from '../../utils/avatar'

defineProps<{ sender: SenderInfo }>()

const accentClasses: Record<NonNullable<SenderInfo['accent']>, string> = {
  primary: 'bg-primary/10 text-primary',
  violet: 'bg-accent-soft text-accent border border-accent-border',
  green: 'bg-success-soft text-success border border-success-border',
  neutral: 'bg-white border border-surface-border text-success'
}
</script>

<template>
  <div
    class="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 text-md font-semibold overflow-hidden"
    :class="sender.avatarDataUrl || sender.color ? '' : accentClasses[sender.accent ?? 'neutral']"
    :style="
      !sender.avatarDataUrl && sender.color
        ? { backgroundColor: sender.color, color: avatarTextColor(sender.color) }
        : undefined
    "
  >
    <img
      v-if="sender.avatarDataUrl"
      :src="sender.avatarDataUrl"
      :alt="sender.name"
      class="w-full h-full object-cover"
    />
    <span v-else-if="sender.icon" class="material-symbols-outlined text-3xl">
      {{ sender.icon }}
    </span>
    <span v-else>{{ sender.initials ?? sender.name.slice(0, 2).toUpperCase() }}</span>
  </div>
</template>
