<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  VENDOR_CAPABILITIES,
  isVendorProviderCompatible,
  type AgentVendor,
  type CreateAgentPayload,
  type PlatformProviderView
} from '@agenthub/shared'
import { ApiError, agentApi } from '../api'
import { DEFAULT_AGENT_COLOR, createAvatarDataUrl, isHexColor } from '../utils/avatar'
import AgentAvatar from './AgentAvatar.vue'
import Modal from './Modal.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import BaseButton from './ui/BaseButton.vue'

const props = defineProps<{ open: boolean; providers: PlatformProviderView[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const VENDORS: AgentVendor[] = ['claude', 'codex']
const AGENT_COLORS = [
  '#3370ff',
  '#7b61ff',
  '#0f9d58',
  '#f59e0b',
  '#ef4444',
  '#0891b2',
  '#475569',
  '#be185d'
]

const form = reactive({
  name: '',
  avatar: null as string | null,
  color: DEFAULT_AGENT_COLOR,
  vendor: 'claude' as AgentVendor,
  platformProviderId: '',
  model: '',
  workingDirectory: '',
  skillSourceDirectories: '',
  systemPrompt: '',
  skills: '',
  mcpServers: '',
  allowedTools: ''
})

const error = ref<string | null>(null)
const avatarError = ref<string | null>(null)
const submitting = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

const caps = computed(() => VENDOR_CAPABILITIES[form.vendor])
const previewColor = computed(() => (isHexColor(form.color) ? form.color : DEFAULT_AGENT_COLOR))

/** Providers whose protocol type is compatible with the chosen vendor. */
const compatibleProviders = computed(() =>
  props.providers.filter((p) => isVendorProviderCompatible(form.vendor, p.type))
)

const selectedProvider = computed(() =>
  props.providers.find((p) => p.id === form.platformProviderId)
)

const modelOptions = computed(() => selectedProvider.value?.modelList ?? [])

function reset(): void {
  form.name = ''
  form.avatar = null
  form.color = DEFAULT_AGENT_COLOR
  form.vendor = 'claude'
  form.platformProviderId = ''
  form.model = ''
  form.workingDirectory = ''
  form.skillSourceDirectories = ''
  form.systemPrompt = ''
  form.skills = ''
  form.mcpServers = ''
  form.allowedTools = ''
  error.value = null
  avatarError.value = null
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  }
)

// Reset dependent selections when vendor / provider changes.
watch(
  () => form.vendor,
  () => {
    form.platformProviderId = ''
    form.model = ''
  }
)
watch(
  () => form.platformProviderId,
  () => {
    form.model = ''
  }
)

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildPayload(): CreateAgentPayload | string {
  if (!form.name.trim()) return '请输入名称'
  if (!isHexColor(form.color)) return '请输入合法颜色，如 #3370ff'
  if (!form.platformProviderId) return '请选择 PlatformProvider'
  if (!form.model) return '请选择模型'
  if (!form.workingDirectory.trim()) return '请输入 Agent 目录'

  const payload: CreateAgentPayload = {
    name: form.name.trim(),
    avatar: form.avatar,
    color: form.color.toLowerCase(),
    vendor: form.vendor,
    platformProviderId: form.platformProviderId,
    model: form.model,
    workingDirectory: form.workingDirectory.trim()
  }

  if (caps.value.supportsSystemPrompt && form.systemPrompt.trim()) {
    payload.systemPrompt = form.systemPrompt
  }
  if (caps.value.supportsSkills && form.skillSourceDirectories.trim()) {
    payload.skillSourceDirectories = parseList(form.skillSourceDirectories)
  }
  if (caps.value.supportsSkills && form.skills.trim()) {
    const skills = form.skills.trim()
    payload.skills = skills === 'all' ? 'all' : parseList(skills)
  }
  if (caps.value.supportsMcp && form.mcpServers.trim()) {
    try {
      payload.mcpServers = JSON.parse(form.mcpServers) as Record<string, unknown>
    } catch {
      return 'MCP 配置不是合法的 JSON'
    }
  }
  const tools = parseList(form.allowedTools)
  if (tools.length) payload.allowedTools = tools

  return payload
}

function selectColor(color: string): void {
  form.color = color
}

function pickAvatar(): void {
  avatarError.value = null
  fileInput.value?.click()
}

function clearAvatar(): void {
  form.avatar = null
  avatarError.value = null
}

function onAvatarFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) {
    avatarError.value = '请选择图片文件'
    return
  }
  void createAvatarDataUrl(file)
    .then((avatar) => {
      form.avatar = avatar
      avatarError.value = null
    })
    .catch(() => {
      avatarError.value = '头像图片过大或无法读取'
    })
}

async function onSubmit(): Promise<void> {
  const result = buildPayload()
  if (typeof result === 'string') {
    error.value = result
    return
  }
  error.value = null
  submitting.value = true
  try {
    await agentApi.create(result)
    emit('created')
    emit('close')
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="新建 Agent" :width="560" @close="emit('close')">
    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">名称</label>
        <BaseInput v-model="form.name" type="text" placeholder="如：后端工程师" />
      </div>

      <div class="rounded-md border border-surface-border bg-surface-hover/60 p-3">
        <div class="flex items-start gap-3">
          <AgentAvatar
            :name="form.name || 'AG'"
            :avatar="form.avatar"
            :color="previewColor"
            size="lg"
          />
          <div class="min-w-0 flex-1">
            <label class="block text-sm font-medium text-text-main mb-1.5">
              头像
              <span class="font-normal text-text-muted">（可选）</span>
            </label>
            <div class="flex flex-wrap gap-2">
              <BaseButton variant="secondary" size="sm" @click="pickAvatar">
                <span class="material-symbols-outlined text-xl">image</span>
                选择头像
              </BaseButton>
              <BaseButton v-if="form.avatar" variant="ghost" size="sm" @click="clearAvatar">
                <span class="material-symbols-outlined text-xl">close</span>
                移除
              </BaseButton>
            </div>
            <p class="mt-1 text-xs text-text-muted">
              不选择头像时，使用颜色和名称前两个字生成默认头像。
            </p>
            <p v-if="avatarError" class="mt-1 text-xs text-danger">{{ avatarError }}</p>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onAvatarFileChange"
            />
          </div>
        </div>

        <div class="mt-3">
          <label class="block text-sm font-medium text-text-main mb-1.5">颜色标识</label>
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-for="color in AGENT_COLORS"
              :key="color"
              type="button"
              class="h-7 w-7 rounded-md border border-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-primary/30"
              :class="form.color.toLowerCase() === color ? 'ring-2 ring-primary/40' : ''"
              :style="{ backgroundColor: color }"
              :title="color"
              @click="selectColor(color)"
            >
              <span class="sr-only">{{ color }}</span>
            </button>
            <BaseInput
              v-model="form.color"
              class="max-w-[116px]"
              :invalid="form.color.length > 0 && !isHexColor(form.color)"
              type="text"
              maxlength="7"
              placeholder="#3370ff"
            />
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">Vendor</label>
          <BaseSelect v-model="form.vendor">
            <option v-for="v in VENDORS" :key="v" :value="v">{{ v }}</option>
          </BaseSelect>
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">PlatformProvider</label>
          <BaseSelect v-model="form.platformProviderId">
            <option value="" disabled>请选择</option>
            <option v-for="p in compatibleProviders" :key="p.id" :value="p.id">
              {{ p.platformName }}
            </option>
          </BaseSelect>
          <p v-if="compatibleProviders.length === 0" class="text-xs text-text-muted mt-1">
            没有与 {{ form.vendor }} 兼容的 Provider，请先在「设置」中添加。
          </p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">模型</label>
        <BaseSelect v-model="form.model" :disabled="modelOptions.length === 0">
          <option value="" disabled>
            {{ modelOptions.length ? '请选择' : '该 Provider 暂无模型' }}
          </option>
          <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
        </BaseSelect>
        <p
          v-if="selectedProvider && modelOptions.length === 0"
          class="text-xs text-text-muted mt-1"
        >
          该 Provider 的模型列表为空，可在「设置」中「刷新模型」后再试。
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">Agent 目录</label>
        <BaseInput
          v-model="form.workingDirectory"
          mono
          type="text"
          placeholder="/path/to/agent-home"
        />
        <p class="mt-1 text-xs text-text-muted">
          单聊时作为工作目录；Agent 私有 skills 会放在这里的 .claude/skills。
        </p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>System Prompt</span>
          <span v-if="!caps.supportsSystemPrompt" class="text-xs font-normal text-text-muted"
            >{{ form.vendor }} 不支持</span
          >
        </label>
        <BaseTextarea
          v-model="form.systemPrompt"
          :disabled="!caps.supportsSystemPrompt"
          rows="3"
          placeholder="可选"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label
            class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5"
          >
            <span>Enabled Skills</span>
            <span v-if="!caps.supportsSkills" class="text-xs font-normal text-text-muted"
              >不支持</span
            >
          </label>
          <BaseInput
            v-model="form.skills"
            :disabled="!caps.supportsSkills"
            type="text"
            placeholder="all 或 逗号分隔"
          />
          <p class="mt-1 text-xs text-text-muted">按名称启用；导入文件夹会自动启用。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">Allowed Tools</label>
          <BaseInput v-model="form.allowedTools" type="text" placeholder="逗号分隔，可选" />
          <p class="mt-1 text-xs text-text-muted">置空即为保持默认。</p>
        </div>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>Skill Folders</span>
          <span v-if="!caps.supportsSkills" class="text-xs font-normal text-text-muted"
            >不支持</span
          >
        </label>
        <BaseInput
          v-model="form.skillSourceDirectories"
          :disabled="!caps.supportsSkills"
          mono
          type="text"
          placeholder="/path/to/skill 或 /path/to/.claude/skills，逗号分隔"
        />
        <p class="mt-1 text-xs text-text-muted">创建时复制到 Agent 目录的 .claude/skills。</p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>MCP Servers (JSON)</span>
          <span v-if="!caps.supportsMcp" class="text-xs font-normal text-text-muted"
            >{{ form.vendor }} 不支持</span
          >
        </label>
        <BaseTextarea
          v-model="form.mcpServers"
          :disabled="!caps.supportsMcp"
          mono
          rows="3"
          placeholder='可选，如 {"fs": {"command": "..."}}'
        />
      </div>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">取消</BaseButton>
      <BaseButton :disabled="submitting" @click="onSubmit">
        {{ submitting ? '创建中…' : '创建' }}
      </BaseButton>
    </template>
  </Modal>
</template>
