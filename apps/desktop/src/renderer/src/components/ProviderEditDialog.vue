<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
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
  modelList: '',
  isDefault: false,
  defaultModel: ''
})
const error = ref<string | null>(null)
const submitting = ref(false)

const isEdit = (): boolean => props.provider !== null
const modelOptions = computed(() => parseModels(form.modelList))

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
    form.isDefault = p?.isDefault ?? false
    form.defaultModel = p?.defaultModel ?? ''
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
  const models = parseModels(form.modelList)
  const defaultModel = form.defaultModel.trim()
  if (form.isDefault && !defaultModel) {
    error.value = '默认 Provider 需要设置默认模型'
    return
  }
  if (form.isDefault && models.length > 0 && !models.includes(defaultModel)) {
    error.value = '默认模型必须存在于模型列表中'
    return
  }
  error.value = null
  submitting.value = true
  try {
    if (isEdit() && props.provider) {
      const payload: UpdateProviderPayload = {
        platformName: form.platformName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        modelList: models,
        isDefault: form.isDefault,
        defaultModel: form.isDefault ? defaultModel : null
      }
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim()
      await providerApi.update(props.provider.id, payload)
    } else {
      const payload: CreateProviderPayload = {
        platformName: form.platformName.trim(),
        type: form.type,
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        ...(models.length ? { modelList: models } : {}),
        isDefault: form.isDefault,
        defaultModel: form.isDefault ? defaultModel : null
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
      <label class="flex items-start gap-2 rounded-md border border-surface-border bg-surface px-3 py-2.5">
        <input
          v-model="form.isDefault"
          type="checkbox"
          class="mt-1 h-4 w-4 rounded border-surface-border text-primary"
        />
        <span>
          <span class="block text-sm font-medium text-text-main">设为默认 Provider</span>
          <span class="block text-xs text-text-muted">
            创建 Agent 或群聊时会优先使用这个 Provider 和默认模型。
          </span>
        </span>
      </label>
      <div v-if="form.isDefault">
        <label class="block text-sm font-medium text-text-main mb-1.5">默认模型</label>
        <BaseSelect v-if="modelOptions.length" v-model="form.defaultModel">
          <option value="" disabled>请选择</option>
          <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
        </BaseSelect>
        <BaseInput
          v-else
          v-model="form.defaultModel"
          mono
          type="text"
          placeholder="如：gpt-4o-mini"
        />
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
