<script setup lang="ts">
import { PROVIDER_TYPE_LABELS, type PlatformProviderView } from '@agenthub/shared'
import BaseButton from './ui/BaseButton.vue'

defineProps<{
  providers: PlatformProviderView[]
  selectedId: string | null
  loading: boolean
}>()
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'add'): void }>()
</script>

<template>
  <div class="w-[260px] flex-shrink-0 border-r border-surface-border bg-surface flex flex-col">
    <header
      class="h-14 px-4 flex items-center justify-between border-b border-surface-border flex-shrink-0"
    >
      <span class="text-base font-medium text-text-main">Provider 列表</span>
      <BaseButton size="sm" @click="emit('add')">
        <span class="material-symbols-outlined text-lg">add</span>
        添加
      </BaseButton>
    </header>
    <div class="flex-1 overflow-y-auto p-2">
      <p v-if="loading" class="text-center text-text-muted text-sm py-6">加载中…</p>
      <p v-else-if="providers.length === 0" class="text-center text-text-muted text-sm py-6">
        还没有 Provider，点击「添加」。
      </p>
      <button
        v-for="p in providers"
        :key="p.id"
        type="button"
        class="w-full text-left px-3 py-2.5 rounded-[8px] mb-1 transition-colors"
        :class="p.id === selectedId ? 'bg-surface-active' : 'hover:bg-surface-hover'"
        @click="emit('select', p.id)"
      >
        <div class="text-base font-medium text-text-main truncate">{{ p.platformName }}</div>
        <div class="text-xs text-text-muted mt-0.5 truncate">
          {{ PROVIDER_TYPE_LABELS[p.type] }}
        </div>
      </button>
    </div>
  </div>
</template>
