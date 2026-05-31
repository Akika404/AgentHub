<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import {
  PROVIDER_TYPES,
  PROVIDER_TYPE_LABELS,
  type CreateProviderPayload,
  type PlatformProviderView,
  type ProviderType,
  type UpdateProviderPayload
} from '@agenthub/shared'
import { ApiError, providerApi } from '../api'
import Modal from './Modal.vue'

const props = defineProps<{
  open: boolean
  /** when set, the dialog edits this provider; otherwise it creates a new one */
  provider: PlatformProviderView | null
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()

const form = reactive({
  platformName: '',
  type: 'openai-chat-completions' as ProviderType,
  baseUrl: '',
  apiKey: '',
  modelList: ''
})
const error = ref<string | null>(null)
const submitting = ref(false)

const isEdit = (): boolean => props.provider !== null

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    error.value = null
    const p = props.provider
    form.platformName = p?.platformName ?? ''
    form.type = p?.type ?? 'openai-chat-completions'
    form.baseUrl = p?.baseUrl ?? ''
    form.apiKey = ''
    form.modelList = p ? p.modelList.join('\n') : ''
  }
)

async function onSubmit(): Promise<void> {
  if (!form.platformName.trim()) {
    error.value = '请输入平台名称'
    return
  }
  if (!/^https?:\/\//.test(form.baseUrl.trim())) {
    error.value = 'baseUrl 必须以 http:// 或 https:// 开头'
    return
  }
  if (!isEdit() && !form.apiKey.trim()) {
    error.value = '请输入 API Key'
    return
  }
  error.value = null
  submitting.value = true
  try {
    const models = parseModels(form.modelList)
    if (isEdit() && props.provider) {
      const payload: UpdateProviderPayload = {
        platformName: form.platformName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        modelList: models
      }
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()
      await providerApi.update(props.provider.id, payload)
    } else {
      const payload: CreateProviderPayload = {
        platformName: form.platformName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        ...(models.length ? { modelList: models } : {})
      }
      await providerApi.create(payload)
    }
    emit('saved')
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '保存失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit() ? '编辑 Provider' : '添加 Provider'"
    :width="520"
    @close="emit('close')"
  >
    <div class="space-y-4">
      <div>
        <label class="block text-[12px] text-text-muted mb-1.5">平台名称</label>
        <input
          v-model="form.platformName"
          type="text"
          placeholder="如：我的 OpenAI"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
        />
      </div>
      <div>
        <label class="block text-[12px] text-text-muted mb-1.5">协议类型</label>
        <select
          v-model="form.type"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
        >
          <option v-for="t in PROVIDER_TYPES" :key="t" :value="t">
            {{ PROVIDER_TYPE_LABELS[t] }}
          </option>
        </select>
      </div>
      <div>
        <label class="block text-[12px] text-text-muted mb-1.5">Base URL</label>
        <input
          v-model="form.baseUrl"
          type="text"
          placeholder="https://api.openai.com/v1"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
        />
      </div>
      <div>
        <label class="block text-[12px] text-text-muted mb-1.5">
          API Key
          <span v-if="isEdit()" class="text-text-muted">（留空保留原密钥）</span>
        </label>
        <input
          v-model="form.apiKey"
          type="password"
          :placeholder="isEdit() ? '••••••••' : 'sk-...'"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
        />
      </div>
      <div>
        <label class="block text-[12px] text-text-muted mb-1.5">
          模型列表 <span class="text-text-muted">（每行一个，可留空后用「刷新模型」拉取）</span>
        </label>
        <textarea
          v-model="form.modelList"
          rows="3"
          placeholder="gpt-4o&#10;gpt-4o-mini"
          class="w-full px-3 py-2 rounded-[8px] border border-surface-border bg-surface text-[13px] font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition resize-y"
        />
      </div>
      <p v-if="error" class="text-[12px] text-red-500">{{ error }}</p>
    </div>

    <template #footer>
      <button
        type="button"
        class="h-9 px-4 rounded-[8px] text-[13px] text-text-main hover:bg-surface-hover transition-colors"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="submitting"
        class="h-9 px-4 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-[13px] font-medium transition-colors disabled:opacity-60"
        @click="onSubmit"
      >
        {{ submitting ? '保存中…' : '保存' }}
      </button>
    </template>
  </Modal>
</template>
