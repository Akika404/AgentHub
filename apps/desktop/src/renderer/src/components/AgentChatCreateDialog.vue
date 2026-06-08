<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { AgentChatView, AgentView, CreateAgentChatPayload } from '@agenthub/shared'
import { ApiError } from '../api'
import { agentChatApi } from '../api/agents'
import AgentAvatar from './AgentAvatar.vue'
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import ServerDirectoryPicker from './ServerDirectoryPicker.vue'
import { vendorLabel } from '../utils/vendor'

const props = defineProps<{
  open: boolean
  agents: AgentView[]
  loading?: boolean
  loadError?: string | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', chat: AgentChatView): void
}>()

const form = reactive({
  agentId: '',
  title: '',
  workingDirectory: '',
  skillSourceDirectories: '',
  mcpServers: ''
})

const submitting = ref(false)
const submitError = ref<string | null>(null)
const directoryPickerTarget = ref<'working' | 'skills' | null>(null)

const selectedAgent = computed(
  () => props.agents.find((agent) => agent.id === form.agentId) ?? null
)
const visibleError = computed(() => submitError.value ?? props.loadError ?? null)
const selectedVendorConfigName = computed(() =>
  selectedAgent.value?.vendor === 'codex' ? '.codex' : '.claude'
)

function reset(): void {
  const first = props.agents[0] ?? null
  form.agentId = first?.id ?? ''
  form.title = ''
  form.workingDirectory = ''
  form.skillSourceDirectories = ''
  form.mcpServers = ''
  submitError.value = null
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  }
)

watch(
  () => props.agents,
  () => {
    if (!props.open || props.agents.some((agent) => agent.id === form.agentId)) return
    reset()
  }
)

watch(
  () => form.agentId,
  (agentId) => {
    const agent = props.agents.find((item) => item.id === agentId)
    if (!agent) return
    if (!agent.capabilities.supportsSkills) form.skillSourceDirectories = ''
    if (!agent.capabilities.supportsMcp) form.mcpServers = ''
  }
)

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
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

function chooseWorkingDirectory(): void {
  directoryPickerTarget.value = 'working'
}

function chooseSkillDirectories(): void {
  if (!selectedAgent.value?.capabilities.supportsSkills) return
  directoryPickerTarget.value = 'skills'
}

function closeDirectoryPicker(): void {
  directoryPickerTarget.value = null
}

function onDirectoryPicked(paths: string[]): void {
  if (directoryPickerTarget.value === 'working') {
    form.workingDirectory = paths[0] ?? form.workingDirectory
    return
  }
  if (directoryPickerTarget.value === 'skills') {
    form.skillSourceDirectories = appendListValues(form.skillSourceDirectories, paths)
  }
}

function buildPayload(): CreateAgentChatPayload | string {
  const agent = selectedAgent.value
  if (!agent) return '请选择 Agent'

  const payload: CreateAgentChatPayload = {
    agentId: agent.id
  }

  if (form.title.trim()) payload.title = form.title.trim()
  if (form.workingDirectory.trim()) payload.workingDirectory = form.workingDirectory.trim()

  const folders = parseList(form.skillSourceDirectories)
  if (folders.length) {
    if (!agent.capabilities.supportsSkills) return `${vendorLabel(agent.vendor)} 不支持 skills`
    payload.skillSourceDirectories = folders
  }

  if (form.mcpServers.trim()) {
    if (!agent.capabilities.supportsMcp) return `${vendorLabel(agent.vendor)} 不支持 MCP`
    try {
      payload.mcpServers = JSON.parse(form.mcpServers) as Record<string, unknown>
    } catch {
      return 'MCP 配置不是合法的 JSON'
    }
  }

  return payload
}

async function onSubmit(): Promise<void> {
  const payload = buildPayload()
  if (typeof payload === 'string') {
    submitError.value = payload
    return
  }

  submitError.value = null
  submitting.value = true
  try {
    const chat = await agentChatApi.create(payload)
    emit('created', chat)
    emit('close')
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Modal :open="open" title="创建聊天" :width="560" @close="emit('close')">
    <div class="space-y-4">
      <p v-if="loading" class="text-sm text-text-muted">正在加载 Agent...</p>
      <p v-else-if="agents.length === 0" class="text-sm text-text-muted">
        还没有可用 Agent。请先在「Agent 管理」里新建一个 Agent。
      </p>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">Agent</label>
        <BaseSelect v-model="form.agentId" :disabled="loading || agents.length === 0">
          <option value="" disabled>请选择</option>
          <option v-for="agent in agents" :key="agent.id" :value="agent.id">
            {{ agent.name }} · {{ vendorLabel(agent.vendor) }} / {{ agent.model }}
          </option>
        </BaseSelect>
        <div
          v-if="selectedAgent"
          class="mt-2 flex items-center gap-2 rounded-md bg-surface-hover p-2"
        >
          <AgentAvatar
            :name="selectedAgent.name"
            :avatar="selectedAgent.avatar"
            :color="selectedAgent.color"
            size="sm"
          />
          <div class="min-w-0">
            <div class="text-base font-medium text-text-main truncate">
              {{ selectedAgent.name }}
            </div>
            <div class="text-xs text-text-muted truncate">
              {{ vendorLabel(selectedAgent.vendor) }} / {{ selectedAgent.model }}
            </div>
          </div>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          标题
          <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <BaseInput v-model="form.title" type="text" placeholder="未填写时自动使用 Agent 名称" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          工作目录
          <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <div class="flex gap-2">
          <BaseInput
            v-model="form.workingDirectory"
            class="min-w-0 flex-1"
            mono
            type="text"
            placeholder="留空自动创建 AgentHome/TaskN"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            @click="chooseWorkingDirectory"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
        <p class="mt-1 text-xs text-text-muted">
          不能与 Agent Home 相同；留空时后端会选择下一个 Task 序号。
        </p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>
            Skill Folders
            <span class="font-normal text-text-muted">（可选，逗号分隔）</span>
          </span>
          <span
            v-if="selectedAgent && !selectedAgent.capabilities.supportsSkills"
            class="text-xs font-normal text-text-muted"
          >
            {{ vendorLabel(selectedAgent.vendor) }} 不支持
          </span>
        </label>
        <div class="flex gap-2">
          <BaseInput
            v-model="form.skillSourceDirectories"
            class="min-w-0 flex-1"
            :disabled="!selectedAgent?.capabilities.supportsSkills"
            mono
            type="text"
            :placeholder="`/path/to/skill 或 /path/to/${selectedVendorConfigName}/skills`"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            :disabled="!selectedAgent?.capabilities.supportsSkills"
            @click="chooseSkillDirectories"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
        <p class="mt-1 text-xs text-text-muted">
          导入到本聊天工作目录的 {{ selectedVendorConfigName }}/skills。
        </p>
      </div>

      <div>
        <label class="flex items-center justify-between text-sm font-medium text-text-main mb-1.5">
          <span>
            MCP Servers (JSON)
            <span class="font-normal text-text-muted">（可选）</span>
          </span>
          <span
            v-if="selectedAgent && !selectedAgent.capabilities.supportsMcp"
            class="text-xs font-normal text-text-muted"
          >
            {{ vendorLabel(selectedAgent.vendor) }} 不支持
          </span>
        </label>
        <BaseTextarea
          v-model="form.mcpServers"
          :disabled="!selectedAgent?.capabilities.supportsMcp"
          mono
          rows="4"
          placeholder='如 {"fs": {"command": "..."}}'
        />
      </div>

      <p v-if="visibleError" class="text-sm text-danger">{{ visibleError }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">取消</BaseButton>
      <BaseButton :disabled="submitting || loading || agents.length === 0" @click="onSubmit">
        {{ submitting ? '创建中...' : '创建' }}
      </BaseButton>
    </template>
  </Modal>

  <ServerDirectoryPicker
    :open="directoryPickerTarget !== null"
    :title="directoryPickerTarget === 'skills' ? '选择服务器 Skill 目录' : '选择服务器工作目录'"
    :mode="directoryPickerTarget === 'skills' ? 'multiple' : 'single'"
    :initial-path="directoryPickerTarget === 'working' ? form.workingDirectory : ''"
    :initial-paths="
      directoryPickerTarget === 'skills' ? parseList(form.skillSourceDirectories) : []
    "
    @confirm="onDirectoryPicked"
    @close="closeDirectoryPicker"
  />
</template>
