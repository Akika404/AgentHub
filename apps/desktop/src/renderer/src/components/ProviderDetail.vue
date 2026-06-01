<script setup lang="ts">
import { ref, watch } from 'vue'
import {
  PROVIDER_TYPE_LABELS,
  type PlatformProviderView,
  type ProviderTestResult
} from '@agenthub/shared'
import { ApiError, providerApi } from '../api'

const props = defineProps<{ provider: PlatformProviderView }>()
const emit = defineEmits<{
  (e: 'edit'): void
  (e: 'delete'): void
  /** modelList changed on the server (after refresh); parent should reload */
  (e: 'refreshed'): void
}>()

const testing = ref(false)
const testResult = ref<ProviderTestResult | null>(null)
const refreshing = ref(false)
const error = ref<string | null>(null)

// Clear transient state when switching providers.
watch(
  () => props.provider.id,
  () => {
    testResult.value = null
    error.value = null
  }
)

async function onTest(): Promise<void> {
  testing.value = true
  testResult.value = null
  error.value = null
  try {
    testResult.value = await providerApi.test(props.provider.id)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '测试失败'
  } finally {
    testing.value = false
  }
}

async function onRefresh(): Promise<void> {
  refreshing.value = true
  error.value = null
  try {
    await providerApi.refreshModels(props.provider.id)
    emit('refreshed')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '刷新模型失败'
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="flex-1 min-w-0 bg-background overflow-y-auto">
    <div class="max-w-[680px] mx-auto p-6">
      <div class="flex items-start justify-between mb-6">
        <div>
          <h2 class="text-2xl font-semibold text-text-main">{{ provider.platformName }}</h2>
          <p class="text-sm text-text-muted mt-1">{{ PROVIDER_TYPE_LABELS[provider.type] }}</p>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="flex items-center gap-1 h-9 px-3 rounded-[8px] border border-surface-border text-text-main hover:bg-surface-hover text-sm font-medium transition-colors"
            @click="emit('edit')"
          >
            <span class="material-symbols-outlined text-xl">edit</span>
            编辑
          </button>
          <button
            type="button"
            class="flex items-center gap-1 h-9 px-3 rounded-[8px] border border-surface-border text-danger hover:bg-danger-soft text-sm font-medium transition-colors"
            @click="emit('delete')"
          >
            <span class="material-symbols-outlined text-xl">delete</span>
            删除
          </button>
        </div>
      </div>

      <section
        class="bg-surface rounded-[10px] border border-surface-border divide-y divide-surface-border"
      >
        <div class="flex px-4 py-3">
          <span class="w-28 flex-shrink-0 text-sm text-text-muted">Base URL</span>
          <span class="text-base text-text-main font-mono break-all">{{ provider.baseUrl }}</span>
        </div>
        <div class="flex px-4 py-3">
          <span class="w-28 flex-shrink-0 text-sm text-text-muted">API Key</span>
          <span class="text-base text-text-main font-mono">{{
            provider.apiKeyMasked ?? '—'
          }}</span>
        </div>
      </section>

      <div class="flex items-center gap-2 mt-4">
        <button
          type="button"
          :disabled="testing"
          class="flex items-center gap-1 h-9 px-3 rounded-[8px] border border-surface-border text-text-main hover:bg-surface-hover text-sm font-medium transition-colors disabled:opacity-60"
          @click="onTest"
        >
          <span class="material-symbols-outlined text-xl">wifi_tethering</span>
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button
          type="button"
          :disabled="refreshing"
          class="flex items-center gap-1 h-9 px-3 rounded-[8px] border border-surface-border text-text-main hover:bg-surface-hover text-sm font-medium transition-colors disabled:opacity-60"
          @click="onRefresh"
        >
          <span class="material-symbols-outlined text-xl">refresh</span>
          {{ refreshing ? '刷新中…' : '刷新模型' }}
        </button>
        <span
          v-if="testResult"
          class="text-sm"
          :class="testResult.ok ? 'text-success' : 'text-danger'"
        >
          {{
            testResult.ok
              ? `连通 · ${testResult.latencyMs}ms${
                  testResult.modelCount != null ? ` · ${testResult.modelCount} 个模型` : ''
                }`
              : `失败：${testResult.message ?? '未知原因'}`
          }}
        </span>
        <span v-if="error" class="text-sm text-danger">{{ error }}</span>
      </div>

      <section class="mt-6">
        <h3 class="text-sm text-text-muted mb-2">
          模型列表（{{ provider.modelList.length }}）
        </h3>
        <div
          v-if="provider.modelList.length"
          class="flex flex-wrap gap-2 bg-surface rounded-[10px] border border-surface-border p-4"
        >
          <span
            v-for="m in provider.modelList"
            :key="m"
            class="px-2.5 py-1 rounded-[6px] bg-surface-hover text-sm text-text-main font-mono"
          >
            {{ m }}
          </span>
        </div>
        <p
          v-else
          class="bg-surface rounded-[10px] border border-surface-border p-4 text-sm text-text-muted"
        >
          暂无模型，点击「刷新模型」从上游拉取。
        </p>
      </section>
    </div>
  </div>
</template>
