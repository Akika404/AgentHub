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
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import BaseButton from './ui/BaseButton.vue'

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
        <label class="block text-sm font-medium text-text-main mb-1.5">平台名称</label>
        <BaseInput v-model="form.platformName" type="text" placeholder="如：我的 OpenAI" />
      </div>
      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">协议类型</label>
        <BaseSelect v-model="form.type">
          <option v-for="t in PROVIDER_TYPES" :key="t" :value="t">
            {{ PROVIDER_TYPE_LABELS[t] }}
          </option>
        </BaseSelect>
      </div>
      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">Base URL</label>
        <BaseInput
          v-model="form.baseUrl"
          mono
          type="text"
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          API Key
          <span v-if="isEdit()" class="font-normal text-text-muted">（留空保留原密钥）</span>
        </label>
        <BaseInput
          v-model="form.apiKey"
          mono
          type="password"
          :placeholder="isEdit() ? '••••••••' : 'sk-...'"
        />
      </div>
      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          模型列表
          <span class="font-normal text-text-muted">（每行一个，可留空后用「刷新模型」拉取）</span>
        </label>
        <BaseTextarea v-model="form.modelList" mono rows="3" placeholder="gpt-4o&#10;gpt-4o-mini" />
      </div>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">取消</BaseButton>
      <BaseButton :disabled="submitting" @click="onSubmit">
        {{ submitting ? '保存中…' : '保存' }}
      </BaseButton>
    </template>
  </Modal>
</template>
