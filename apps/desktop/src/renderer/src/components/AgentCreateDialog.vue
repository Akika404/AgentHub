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
import Modal from './Modal.vue'

const props = defineProps<{ open: boolean; providers: PlatformProviderView[] }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'created'): void }>()

const VENDORS: AgentVendor[] = ['claude', 'codex']

const form = reactive({
  name: '',
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
const submitting = ref(false)

const caps = computed(() => VENDOR_CAPABILITIES[form.vendor])

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
  if (!form.platformProviderId) return '请选择 PlatformProvider'
  if (!form.model) return '请选择模型'
  if (!form.workingDirectory.trim()) return '请输入 Agent 目录'

  const payload: CreateAgentPayload = {
    name: form.name.trim(),
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
        <input
          v-model="form.name"
          type="text"
          placeholder="如：后端工程师"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">Vendor</label>
          <select
            v-model="form.vendor"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          >
            <option v-for="v in VENDORS" :key="v" :value="v">{{ v }}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">PlatformProvider</label>
          <select
            v-model="form.platformProviderId"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          >
            <option value="" disabled>请选择</option>
            <option v-for="p in compatibleProviders" :key="p.id" :value="p.id">
              {{ p.platformName }}
            </option>
          </select>
          <p v-if="compatibleProviders.length === 0" class="text-xs text-text-muted mt-1">
            没有与 {{ form.vendor }} 兼容的 Provider，请先在「设置」中添加。
          </p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">模型</label>
        <select
          v-model="form.model"
          :disabled="modelOptions.length === 0"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition disabled:bg-surface-hover disabled:text-text-muted"
        >
          <option value="" disabled>
            {{ modelOptions.length ? '请选择' : '该 Provider 暂无模型' }}
          </option>
          <option v-for="m in modelOptions" :key="m" :value="m">{{ m }}</option>
        </select>
        <p
          v-if="selectedProvider && modelOptions.length === 0"
          class="text-xs text-text-muted mt-1"
        >
          该 Provider 的模型列表为空，可在「设置」中「刷新模型」后再试。
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">Agent 目录</label>
        <input
          v-model="form.workingDirectory"
          type="text"
          placeholder="/path/to/agent-home"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
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
        <textarea
          v-model="form.systemPrompt"
          :disabled="!caps.supportsSystemPrompt"
          rows="3"
          placeholder="可选"
          class="w-full px-3 py-2 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition resize-y disabled:bg-surface-hover disabled:text-text-muted"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
            <span>Enabled Skills</span>
            <span v-if="!caps.supportsSkills" class="text-xs font-normal text-text-muted"
              >不支持</span
            >
          </label>
          <input
            v-model="form.skills"
            :disabled="!caps.supportsSkills"
            type="text"
            placeholder="all 或 逗号分隔"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition disabled:bg-surface-hover disabled:text-text-muted"
          />
          <p class="mt-1 text-xs text-text-muted">按名称启用；导入文件夹会自动启用。</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">Allowed Tools</label>
          <input
            v-model="form.allowedTools"
            type="text"
            placeholder="逗号分隔，可选"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
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
        <input
          v-model="form.skillSourceDirectories"
          :disabled="!caps.supportsSkills"
          type="text"
          placeholder="/path/to/skill 或 /path/to/.claude/skills，逗号分隔"
          class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-base font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition disabled:bg-surface-hover disabled:text-text-muted"
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
        <textarea
          v-model="form.mcpServers"
          :disabled="!caps.supportsMcp"
          rows="3"
          placeholder='可选，如 {"fs": {"command": "..."}}'
          class="w-full px-3 py-2 rounded-[8px] border border-surface-border bg-surface text-base font-mono outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition resize-y disabled:bg-surface-hover disabled:text-text-muted"
        />
      </div>

      <p v-if="error" class="text-sm text-danger">{{ error }}</p>
    </div>

    <template #footer>
      <button
        type="button"
        class="h-9 px-4 rounded-[8px] text-base text-text-main hover:bg-surface-hover transition-colors"
        @click="emit('close')"
      >
        取消
      </button>
      <button
        type="button"
        :disabled="submitting"
        class="h-9 px-4 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-base font-medium transition-colors disabled:opacity-60"
        @click="onSubmit"
      >
        {{ submitting ? '创建中…' : '创建' }}
      </button>
    </template>
  </Modal>
</template>
