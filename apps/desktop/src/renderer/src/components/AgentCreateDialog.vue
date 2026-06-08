<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  VENDOR_CAPABILITIES,
  isVendorProviderCompatible,
  type AgentView,
  type AgentVendor,
  type CreateAgentPayload,
  type UpdateAgentPayload,
  type PlatformProviderView
} from '@agenthub/shared'
import { ApiError, agentApi } from '../api'
import { DEFAULT_AGENT_COLOR, createAvatarDataUrl, isHexColor } from '../utils/avatar'
import { vendorLabel } from '../utils/vendor'
import AgentAvatar from './AgentAvatar.vue'
import Modal from './Modal.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import BaseButton from './ui/BaseButton.vue'
import ServerDirectoryPicker from './ServerDirectoryPicker.vue'

const props = withDefaults(
  defineProps<{ open: boolean; providers: PlatformProviderView[]; agent?: AgentView | null }>(),
  { agent: null }
)
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created'): void
  (e: 'updated'): void
}>()

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
  capabilitySummary: '',
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
const directoryPickerTarget = ref<'agent' | 'skills' | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const suspendDependentWatchers = ref(false)

const isEdit = computed(() => props.agent !== null)
const caps = computed(() => VENDOR_CAPABILITIES[form.vendor])
const previewColor = computed(() => (isHexColor(form.color) ? form.color : DEFAULT_AGENT_COLOR))
const vendorConfigName = computed(() => (form.vendor === 'claude' ? '.claude' : '.codex'))

/** Providers whose protocol type is compatible with the chosen vendor. */
const compatibleProviders = computed(() =>
  props.providers.filter((p) => isVendorProviderCompatible(form.vendor, p.type))
)

const selectedProvider = computed(() =>
  props.providers.find((p) => p.id === form.platformProviderId)
)

const modelOptions = computed(() => selectedProvider.value?.modelList ?? [])

function stringifyConfig(value: unknown): string {
  if (value == null) return ''
  return JSON.stringify(value, null, 2)
}

function formatSkills(value: AgentView['skills']): string {
  if (value == null) return ''
  return value === 'all' ? 'all' : value.join(', ')
}

function reset(): void {
  suspendDependentWatchers.value = true
  const agent = props.agent
  form.name = agent?.name ?? ''
  form.avatar = agent?.avatar ?? null
  form.color = agent?.color ?? DEFAULT_AGENT_COLOR
  form.capabilitySummary = agent?.capabilitySummary ?? ''
  form.vendor = agent?.vendor ?? 'claude'
  form.platformProviderId = agent?.platformProviderId ?? ''
  form.model = agent?.model ?? ''
  form.workingDirectory = agent?.workingDirectory ?? ''
  form.skillSourceDirectories = ''
  form.systemPrompt = agent?.systemPrompt ?? ''
  form.skills = formatSkills(agent?.skills ?? null)
  form.mcpServers = stringifyConfig(agent?.mcpServers ?? null)
  form.allowedTools = agent?.allowedTools?.join(', ') ?? ''
  error.value = null
  avatarError.value = null
  queueMicrotask(() => {
    suspendDependentWatchers.value = false
  })
}

watch(
  () => [props.open, props.agent?.id] as const,
  ([open]) => {
    if (open) reset()
  }
)

// Reset dependent selections when vendor / provider changes.
watch(
  () => form.vendor,
  () => {
    if (suspendDependentWatchers.value) return
    form.platformProviderId = ''
    form.model = ''
  }
)
watch(
  () => form.platformProviderId,
  () => {
    if (suspendDependentWatchers.value) return
    form.model = ''
  }
)

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function appendListValue(value: string, item: string): string {
  const items = parseList(value)
  if (!items.includes(item)) items.push(item)
  return items.join(', ')
}

function appendListValues(value: string, nextItems: string[]): string {
  return nextItems.reduce((current, item) => appendListValue(current, item), value)
}

function buildPayload(): CreateAgentPayload | UpdateAgentPayload | string {
  if (!form.name.trim()) return '请输入名称'
  if (!isHexColor(form.color)) return '请输入合法颜色，如 #3370ff'
  if (!form.platformProviderId) return '请选择 PlatformProvider'
  if (!form.model) return '请选择模型'
  if (!form.workingDirectory.trim()) return '请输入工作目录'

  const payload: CreateAgentPayload | UpdateAgentPayload = {
    name: form.name.trim(),
    avatar: form.avatar,
    color: form.color.toLowerCase(),
    vendor: form.vendor,
    platformProviderId: form.platformProviderId,
    model: form.model,
    workingDirectory: form.workingDirectory.trim()
  }
  if (form.capabilitySummary.trim()) {
    payload.capabilitySummary = form.capabilitySummary.trim()
  } else if (isEdit.value) {
    payload.capabilitySummary = null
  }

  if (caps.value.supportsSystemPrompt) {
    if (form.systemPrompt.trim()) payload.systemPrompt = form.systemPrompt
    else if (isEdit.value) payload.systemPrompt = null
  }
  if (caps.value.supportsSkills && form.skillSourceDirectories.trim()) {
    payload.skillSourceDirectories = parseList(form.skillSourceDirectories)
  }
  if (caps.value.supportsSkills) {
    if (form.skills.trim()) {
      const skills = form.skills.trim()
      payload.skills = skills === 'all' ? 'all' : parseList(skills)
    } else if (isEdit.value) {
      payload.skills = null
    }
  }
  if (caps.value.supportsMcp) {
    if (form.mcpServers.trim()) {
      try {
        payload.mcpServers = JSON.parse(form.mcpServers) as Record<string, unknown>
      } catch {
        return 'MCP 配置不是合法的 JSON'
      }
    } else if (isEdit.value) {
      payload.mcpServers = null
    }
  }
  const tools = parseList(form.allowedTools)
  if (tools.length) payload.allowedTools = tools
  else if (isEdit.value) payload.allowedTools = null

  if (isEdit.value && !caps.value.supportsSystemPrompt) payload.systemPrompt = null
  if (isEdit.value && !caps.value.supportsSkills) payload.skills = null
  if (isEdit.value && !caps.value.supportsMcp) payload.mcpServers = null

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

function chooseAgentDirectory(): void {
  directoryPickerTarget.value = 'agent'
}

function chooseSkillDirectory(): void {
  if (!caps.value.supportsSkills) return
  directoryPickerTarget.value = 'skills'
}

function closeDirectoryPicker(): void {
  directoryPickerTarget.value = null
}

function onDirectoryPicked(paths: string[]): void {
  if (directoryPickerTarget.value === 'agent') {
    form.workingDirectory = paths[0] ?? form.workingDirectory
    return
  }
  if (directoryPickerTarget.value === 'skills') {
    form.skillSourceDirectories = appendListValues(form.skillSourceDirectories, paths)
  }
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
    if (isEdit.value && props.agent) {
      await agentApi.update(props.agent.id, result as UpdateAgentPayload)
      emit('updated')
    } else {
      await agentApi.create(result as CreateAgentPayload)
      emit('created')
    }
    emit('close')
  } catch (err) {
    error.value =
      err instanceof ApiError ? err.message : isEdit.value ? '保存失败，请重试' : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit ? '编辑 Agent' : '新建 Agent'"
    :width="560"
    @close="emit('close')"
  >
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

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          能力摘要
          <span class="font-normal text-text-muted">（给 Orchestrator 看，可选）</span>
        </label>
        <BaseTextarea
          v-model="form.capabilitySummary"
          rows="2"
          placeholder="如：负责产品需求梳理、交互评审和 MVP 范围判断"
        />
        <p class="mt-1 text-xs text-text-muted">
          群聊编排时会用它判断这个 Agent 擅长什么，不会作为 system prompt 注入。
        </p>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">Vendor</label>
          <BaseSelect v-model="form.vendor">
            <option v-for="v in VENDORS" :key="v" :value="v">{{ vendorLabel(v) }}</option>
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
            没有与 {{ vendorLabel(form.vendor) }} 兼容的 Provider，请先在「设置」中添加。
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
        <label class="block text-sm font-medium text-text-main mb-1.5">工作目录</label>
        <div class="flex gap-2">
          <BaseInput
            v-model="form.workingDirectory"
            class="min-w-0 flex-1"
            mono
            type="text"
            placeholder="/path/to/workspace"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            @click="chooseAgentDirectory"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
        <p class="mt-1 text-xs text-text-muted">
          必须位于当前用户的 agent_workspace；Agent Home 由后端分配到 agent_home，skills 会放在 {{ vendorConfigName }}/skills。
        </p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>System Prompt</span>
          <span v-if="!caps.supportsSystemPrompt" class="text-xs font-normal text-text-muted"
            >{{ vendorLabel(form.vendor) }} 不支持</span
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
        <div class="flex gap-2">
          <BaseInput
            v-model="form.skillSourceDirectories"
            class="min-w-0 flex-1"
            :disabled="!caps.supportsSkills"
            mono
            type="text"
            :placeholder="`/path/to/skill 或 /path/to/${vendorConfigName}/skills，逗号分隔`"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            :disabled="!caps.supportsSkills"
            @click="chooseSkillDirectory"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
        <p class="mt-1 text-xs text-text-muted">
          {{
            isEdit
              ? `保存时导入到 Agent Home 的 ${vendorConfigName}/skills。`
              : `创建时复制到 Agent Home 的 ${vendorConfigName}/skills。`
          }}
        </p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>MCP Servers (JSON)</span>
          <span v-if="!caps.supportsMcp" class="text-xs font-normal text-text-muted"
            >{{ vendorLabel(form.vendor) }} 不支持</span
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
        {{ submitting ? (isEdit ? '保存中…' : '创建中…') : isEdit ? '保存' : '创建' }}
      </BaseButton>
    </template>
  </Modal>

  <ServerDirectoryPicker
    :open="directoryPickerTarget !== null"
    :title="directoryPickerTarget === 'skills' ? '选择服务器 Skill 目录' : '选择服务器工作目录'"
    :mode="directoryPickerTarget === 'skills' ? 'multiple' : 'single'"
    :preferred-kind="directoryPickerTarget === 'skills' ? 'skills' : 'agent_workspace'"
    :initial-path="directoryPickerTarget === 'agent' ? form.workingDirectory : ''"
    :initial-paths="
      directoryPickerTarget === 'skills' ? parseList(form.skillSourceDirectories) : []
    "
    @confirm="onDirectoryPicked"
    @close="closeDirectoryPicker"
  />
</template>
