<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { AgentChatView, AgentView, CreateAgentChatPayload } from '@agenthub/shared'
import { ApiError } from '../api'
import { agentChatApi } from '../api/agents'
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'

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

const selectedAgent = computed(
  () => props.agents.find((agent) => agent.id === form.agentId) ?? null
)
const visibleError = computed(() => submitError.value ?? props.loadError ?? null)

function reset(): void {
  const first = props.agents[0] ?? null
  form.agentId = first?.id ?? ''
  form.title = ''
  form.workingDirectory = first?.workingDirectory ?? ''
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
  (agentId, previousAgentId) => {
    const agent = props.agents.find((item) => item.id === agentId)
    if (!agent) return
    const previous = props.agents.find((item) => item.id === previousAgentId)
    if (!form.workingDirectory.trim() || form.workingDirectory === previous?.workingDirectory) {
      form.workingDirectory = agent.workingDirectory
    }
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

function buildPayload(): CreateAgentChatPayload | string {
  const agent = selectedAgent.value
  if (!agent) return '请选择 Agent'
  if (!form.workingDirectory.trim()) return '请输入工作目录'

  const payload: CreateAgentChatPayload = {
    agentId: agent.id,
    workingDirectory: form.workingDirectory.trim()
  }

  if (form.title.trim()) payload.title = form.title.trim()

  const folders = parseList(form.skillSourceDirectories)
  if (folders.length) {
    if (!agent.capabilities.supportsSkills) return `${agent.vendor} 不支持 skills`
    payload.skillSourceDirectories = folders
  }

  if (form.mcpServers.trim()) {
    if (!agent.capabilities.supportsMcp) return `${agent.vendor} 不支持 MCP`
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
            {{ agent.name }} · {{ agent.vendor }} / {{ agent.model }}
          </option>
        </BaseSelect>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          标题
          <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <BaseInput v-model="form.title" type="text" placeholder="未填写时自动使用 Agent 名称" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">工作目录</label>
        <BaseInput
          v-model="form.workingDirectory"
          mono
          type="text"
          placeholder="/path/to/workspace"
        />
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
            {{ selectedAgent.vendor }} 不支持
          </span>
        </label>
        <BaseInput
          v-model="form.skillSourceDirectories"
          :disabled="!selectedAgent?.capabilities.supportsSkills"
          mono
          type="text"
          placeholder="/path/to/skill 或 /path/to/.claude/skills"
        />
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
            {{ selectedAgent.vendor }} 不支持
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
</template>
