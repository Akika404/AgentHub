<script setup lang="ts">
import type { ChatDetail } from '../api'
import BaseButton from './ui/BaseButton.vue'

defineProps<{ detail: ChatDetail | null }>()
</script>

<template>
  <header
    class="border-b border-surface-border flex items-center px-5 justify-between flex-shrink-0 bg-surface z-10 sticky top-0 h-16"
  >
    <div class="flex flex-col">
      <div class="flex items-center space-x-2">
        <h1 class="font-semibold text-text-main text-lg">{{ detail?.title ?? '—' }}</h1>
        <span
          v-if="detail?.status"
          class="bg-green-100 text-green-700 py-0.5 rounded-full font-medium text-xs px-2"
        >
          {{ detail.status }}
        </span>
      </div>
      <span v-if="detail" class="text-text-muted mt-0.5 text-sm">
        {{ detail.agentCount }} Agents
      </span>
    </div>
    <div class="flex items-center space-x-3 text-text-muted">
      <BaseButton variant="ghost" icon>
        <span class="material-symbols-outlined text-3xl">search</span>
      </BaseButton>
      <BaseButton variant="ghost" icon>
        <span class="material-symbols-outlined text-3xl">more_horiz</span>
      </BaseButton>
    </div>
  </header>
</template>
