<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PlatformProviderView } from '@agenthub/shared'
import { ApiError, providerApi } from '../api'
import ProviderList from '../components/ProviderList.vue'
import ProviderDetail from '../components/ProviderDetail.vue'
import ProviderEditDialog from '../components/ProviderEditDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

type SettingsSection = 'platform-provider'

const SECTIONS: { key: SettingsSection; label: string; icon: string }[] = [
  { key: 'platform-provider', label: 'PlatformProvider', icon: 'cloud' }
]

const section = ref<SettingsSection>('platform-provider')

const providers = ref<PlatformProviderView[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

const dialogOpen = ref(false)
const editTarget = ref<PlatformProviderView | null>(null)
const deleteConfirmOpen = ref(false)
const deleting = ref(false)

const selected = computed(() => providers.value.find((p) => p.id === selectedId.value) ?? null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    providers.value = await providerApi.list()
    if (!selectedId.value || !providers.value.some((p) => p.id === selectedId.value)) {
      selectedId.value = providers.value[0]?.id ?? null
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editTarget.value = null
  dialogOpen.value = true
}

function openEdit(): void {
  editTarget.value = selected.value
  dialogOpen.value = true
}

async function onSaved(): Promise<void> {
  await load()
}

async function onDelete(): Promise<void> {
  const p = selected.value
  if (!p) return
  deleting.value = true
  try {
    await providerApi.delete(p.id)
    deleteConfirmOpen.value = false
    selectedId.value = null
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '删除失败'
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-1 h-full min-w-0">
    <!-- settings sidebar -->
    <div class="w-[240px] flex-shrink-0 border-r border-surface-border bg-surface flex flex-col">
      <header class="h-16 px-4 flex items-center border-b border-surface-border flex-shrink-0">
        <h1 class="font-semibold text-text-main text-lg">设置</h1>
      </header>
      <nav class="p-2">
        <button
          v-for="s in SECTIONS"
          :key="s.key"
          type="button"
          class="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-base transition-colors"
          :class="
            section === s.key
              ? 'bg-surface-active text-primary'
              : 'text-text-main hover:bg-surface-hover'
          "
          @click="section = s.key"
        >
          <span class="material-symbols-outlined text-2xl">{{ s.icon }}</span>
          {{ s.label }}
        </button>
      </nav>
    </div>

    <!-- content: two columns for PlatformProvider -->
    <template v-if="section === 'platform-provider'">
      <ProviderList
        :providers="providers"
        :selected-id="selectedId"
        :loading="loading"
        @select="selectedId = $event"
        @add="openCreate"
      />
      <ProviderDetail
        v-if="selected"
        :provider="selected"
        @edit="openEdit"
        @delete="deleteConfirmOpen = true"
        @refreshed="load"
      />
      <div v-else class="flex-1 flex items-center justify-center text-text-muted text-base">
        {{ loading ? '加载中…' : '选择或添加一个 Provider' }}
      </div>
    </template>

    <p
      v-if="error"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-danger-soft text-danger-strong text-sm px-4 py-2 rounded-md border border-danger-border z-50"
    >
      {{ error }}
    </p>

    <ProviderEditDialog
      :open="dialogOpen"
      :provider="editTarget"
      @close="dialogOpen = false"
      @saved="onSaved"
    />
    <ConfirmDialog
      :open="deleteConfirmOpen"
      title="删除 Provider"
      :message="selected ? `确认删除 Provider「${selected.platformName}」？` : ''"
      confirm-label="删除"
      confirming-label="删除中..."
      :confirming="deleting"
      @close="deleteConfirmOpen = false"
      @confirm="onDelete"
    />
  </div>
</template>
