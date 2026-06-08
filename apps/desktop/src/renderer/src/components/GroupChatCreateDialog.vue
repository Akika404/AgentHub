<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  isVendorProviderCompatible,
  type AgentVendor,
  type AgentView,
  type CreateGroupChatPayload,
  type GroupChatView,
  type PlatformProviderView,
  type ProjectStatus
} from '@agenthub/shared'
import { ApiError } from '../api'
import { agentApi } from '../api/agents'
import { providerApi } from '../api/providers'
import { groupChatApi } from '../api/group-chats'
import AgentAvatar from './AgentAvatar.vue'
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'
import BaseTextarea from './ui/BaseTextarea.vue'
import ServerDirectoryPicker from './ServerDirectoryPicker.vue'
import { vendorLabel } from '../utils/vendor'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'created', group: GroupChatView): void
}>()

const VENDORS: AgentVendor[] = ['claude', 'codex']
const STATUSES: ProjectStatus[] = ['planning', 'designing', 'development', 'done']

const agents = ref<AgentView[]>([])
const providers = ref<PlatformProviderView[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const form = reactive({
  title: '',
  memberIds: new Set<string>(),
  orchestratorVendor: 'claude' as AgentVendor,
  orchestratorProviderId: '',
  orchestratorModel: '',
  projectName: '',
  projectGoal: '',
  techStack: '',
  projectStatus: 'planning' as ProjectStatus,
  workspaceDir: ''
})

const submitting = ref(false)
const submitError = ref<string | null>(null)
const workspacePickerOpen = ref(false)

const compatibleProviders = computed(() =>
  providers.value.filter((p) => isVendorProviderCompatible(form.orchestratorVendor, p.type))
)
const selectedProvider = computed(
  () => providers.value.find((p) => p.id === form.orchestratorProviderId) ?? null
)
const visibleError = computed(() => submitError.value ?? loadError.value ?? null)

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    const [agentList, providerList] = await Promise.all([agentApi.list(), providerApi.list()])
    agents.value = agentList
    providers.value = providerList
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : '加载 Agent / Provider 失败'
  } finally {
    loading.value = false
  }
}

function reset(): void {
  form.title = ''
  form.memberIds = new Set()
  form.orchestratorVendor = 'claude'
  form.orchestratorProviderId = ''
  form.orchestratorModel = ''
  form.projectName = ''
  form.projectGoal = ''
  form.techStack = ''
  form.projectStatus = 'planning'
  form.workspaceDir = ''
  submitError.value = null
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      reset()
      void load()
    }
  }
)

// vendor 变化时，若当前 provider 不再兼容则清空
watch(
  () => form.orchestratorVendor,
  () => {
    if (!compatibleProviders.value.some((p) => p.id === form.orchestratorProviderId)) {
      form.orchestratorProviderId = ''
      form.orchestratorModel = ''
    }
  }
)
watch(
  () => form.orchestratorProviderId,
  () => {
    if (!selectedProvider.value?.modelList.includes(form.orchestratorModel)) {
      form.orchestratorModel = selectedProvider.value?.modelList[0] ?? ''
    }
  }
)

function toggleMember(id: string): void {
  const next = new Set(form.memberIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  form.memberIds = next
}

function buildPayload(): CreateGroupChatPayload | string {
  if (!form.title.trim()) return '请填写群标题'
  if (form.memberIds.size === 0) return '请至少选择一个成员 Agent'
  if (!form.orchestratorProviderId) return '请为 Orchestrator 选择 Provider'
  if (!form.orchestratorModel.trim()) return '请为 Orchestrator 选择模型'
  if (!form.projectName.trim()) return '请填写项目名'

  return {
    title: form.title.trim(),
    memberAgentIds: [...form.memberIds],
    orchestrator: {
      vendor: form.orchestratorVendor,
      model: form.orchestratorModel.trim(),
      providerId: form.orchestratorProviderId
    },
    projectMeta: {
      name: form.projectName.trim(),
      goal: form.projectGoal.trim() || null,
      techStack: form.techStack
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      status: form.projectStatus
    },
    ...(form.workspaceDir.trim() ? { workspaceDir: form.workspaceDir.trim() } : {})
  }
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
    const group = await groupChatApi.create(payload)
    emit('created', group)
    emit('close')
  } catch (err) {
    submitError.value = err instanceof ApiError ? err.message : '创建失败，请重试'
  } finally {
    submitting.value = false
  }
}

function chooseWorkspaceDirectory(): void {
  workspacePickerOpen.value = true
}

function closeWorkspacePicker(): void {
  workspacePickerOpen.value = false
}

function onWorkspacePicked(paths: string[]): void {
  form.workspaceDir = paths[0] ?? form.workspaceDir
}
</script>

<template>
  <Modal :open="open" title="创建群聊" :width="600" @close="emit('close')">
    <div class="space-y-4">
      <p v-if="loading" class="text-sm text-text-muted">正在加载 Agent / Provider...</p>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">群标题</label>
        <BaseInput v-model="form.title" type="text" placeholder="如：时区计算器小组" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          成员 Agent
          <span class="font-normal text-text-muted">（多选）</span>
        </label>
        <p v-if="!loading && agents.length === 0" class="text-sm text-text-muted">
          还没有可用 Agent，请先在「Agent 管理」中创建。
        </p>
        <div
          v-else
          class="max-h-48 space-y-1.5 overflow-y-auto rounded-md border border-surface-border p-2"
        >
          <button
            v-for="agent in agents"
            :key="agent.id"
            type="button"
            class="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors"
            :class="
              form.memberIds.has(agent.id)
                ? 'bg-primary-soft text-primary'
                : 'hover:bg-surface-hover text-text-main'
            "
            @click="toggleMember(agent.id)"
          >
            <span
              class="material-symbols-outlined text-xl"
              :class="form.memberIds.has(agent.id) ? 'text-primary' : 'text-text-muted'"
            >
              {{ form.memberIds.has(agent.id) ? 'check_box' : 'check_box_outline_blank' }}
            </span>
            <AgentAvatar :name="agent.name" :avatar="agent.avatar" :color="agent.color" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-base font-medium">{{ agent.name }}</span>
              <span class="block truncate text-xs text-text-muted">
                {{ vendorLabel(agent.vendor) }} / {{ agent.model }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <div class="rounded-md bg-surface-hover p-3">
        <div class="mb-2 flex items-center gap-1.5 text-sm font-medium text-text-main">
          <span class="material-symbols-outlined text-xl text-accent">hub</span>
          Orchestrator（独立编排者）
        </div>
        <div class="grid grid-cols-3 gap-2">
          <div>
            <label class="mb-1 block text-xs text-text-muted">Vendor</label>
            <BaseSelect v-model="form.orchestratorVendor">
              <option v-for="v in VENDORS" :key="v" :value="v">{{ vendorLabel(v) }}</option>
            </BaseSelect>
          </div>
          <div>
            <label class="mb-1 block text-xs text-text-muted">Provider</label>
            <BaseSelect v-model="form.orchestratorProviderId">
              <option value="" disabled>请选择</option>
              <option v-for="p in compatibleProviders" :key="p.id" :value="p.id">
                {{ p.platformName }}
              </option>
            </BaseSelect>
          </div>
          <div>
            <label class="mb-1 block text-xs text-text-muted">Model</label>
            <BaseSelect v-model="form.orchestratorModel" :disabled="!selectedProvider">
              <option value="" disabled>请选择</option>
              <option v-for="m in selectedProvider?.modelList ?? []" :key="m" :value="m">
                {{ m }}
              </option>
            </BaseSelect>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">项目名</label>
          <BaseInput v-model="form.projectName" type="text" placeholder="如：时区计算器" />
        </div>
        <div>
          <label class="block text-sm font-medium text-text-main mb-1.5">阶段</label>
          <BaseSelect v-model="form.projectStatus">
            <option v-for="s in STATUSES" :key="s" :value="s">{{ s }}</option>
          </BaseSelect>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          项目目标 <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <BaseTextarea v-model="form.projectGoal" rows="2" placeholder="一句话描述项目总目标" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          技术栈 <span class="font-normal text-text-muted">（可选，逗号分隔）</span>
        </label>
        <BaseInput v-model="form.techStack" type="text" placeholder="React, Vite, TailwindCSS" />
      </div>

      <div>
        <label class="block text-sm font-medium text-text-main mb-1.5">
          共享工作区目录 <span class="font-normal text-text-muted">（可选）</span>
        </label>
        <div class="flex gap-2">
          <BaseInput
            v-model="form.workspaceDir"
            class="min-w-0 flex-1"
            mono
            type="text"
            placeholder="留空时后端自动分配并 git init"
          />
          <BaseButton
            class="shrink-0 whitespace-nowrap"
            variant="secondary"
            size="lg"
            @click="chooseWorkspaceDirectory"
          >
            <span class="material-symbols-outlined text-xl">folder_open</span>
            选择目录
          </BaseButton>
        </div>
      </div>

      <p v-if="visibleError" class="text-sm text-danger">{{ visibleError }}</p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="emit('close')">取消</BaseButton>
      <BaseButton :disabled="submitting || loading" @click="onSubmit">
        {{ submitting ? '创建中...' : '创建' }}
      </BaseButton>
    </template>
  </Modal>

  <ServerDirectoryPicker
    :open="workspacePickerOpen"
    title="选择服务器共享工作区"
    mode="single"
    :initial-path="form.workspaceDir"
    @confirm="onWorkspacePicked"
    @close="closeWorkspacePicker"
  />
</template>
