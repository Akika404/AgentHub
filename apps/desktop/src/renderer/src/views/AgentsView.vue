<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AgentView, PlatformProviderView } from '@agenthub/shared'
import { ApiError, agentApi, agentChatApi, providerApi } from '../api'
import AgentAvatar from '../components/AgentAvatar.vue'
import AgentCreateDialog from '../components/AgentCreateDialog.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ContextMenu, { type MenuItem } from '../components/ContextMenu.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseSkeleton from '../components/ui/BaseSkeleton.vue'
import { vendorLabel } from '../utils/vendor'

const agents = ref<AgentView[]>([])
const providers = ref<PlatformProviderView[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const createOpen = ref(false)
const editOpen = ref(false)
const editingAgent = ref<AgentView | null>(null)
const editConfirmOpen = ref(false)
const pendingEditAgent = ref<AgentView | null>(null)
const pendingEditChatCount = ref(0)
const checkingEditUsage = ref(false)
const deleteConfirmOpen = ref(false)
const deleting = ref(false)
const menuOpen = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuTarget = ref<AgentView | null>(null)

const selected = computed(() => agents.value.find((a) => a.id === selectedId.value) ?? null)

const menuItems = computed<MenuItem[]>(() => [
  {
    id: 'edit',
    label: checkingEditUsage.value ? '检查中...' : '编辑',
    icon: 'edit',
    disabled: checkingEditUsage.value
  },
  { id: 'delete', label: '删除', icon: 'delete' }
])

function providerName(id: string): string {
  return providers.value.find((p) => p.id === id)?.platformName ?? id
}

function skillsText(agent: AgentView): string {
  const s = agent.skills
  if (s == null) return '—'
  if (s === 'all') return 'all'
  return s.length ? s.join(', ') : '—'
}

function mcpText(agent: AgentView): string {
  const m = agent.mcpServers
  if (!m) return '—'
  const keys = Object.keys(m)
  return keys.length ? keys.join(', ') : '—'
}

function toolsText(agent: AgentView): string {
  const t = agent.allowedTools
  return t && t.length ? t.join(', ') : '—'
}

function vendorTagClass(vendor: AgentView['vendor']): string {
  if (vendor === 'claude') return 'border-[#fed7aa] bg-[#fff7ed] text-[#b45309]'
  if (vendor === 'codex') return 'border-primary/30 bg-primary-soft text-primary'
  return 'border-surface-border bg-surface-hover text-text-muted'
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [agentList, providerList] = await Promise.all([agentApi.list(), providerApi.list()])
    agents.value = agentList
    providers.value = providerList
    if (!selectedId.value || !agents.value.some((a) => a.id === selectedId.value)) {
      selectedId.value = agents.value[0]?.id ?? null
    }
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function onCreated(): Promise<void> {
  await load()
}

async function onUpdated(): Promise<void> {
  await load()
}

async function refreshProvidersForDialog(): Promise<boolean> {
  try {
    providers.value = await providerApi.list()
    return true
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Provider 列表加载失败'
    return false
  }
}

async function openCreateDialog(): Promise<void> {
  if (!(await refreshProvidersForDialog())) return
  createOpen.value = true
}

function openAgentMenu(event: MouseEvent, agent: AgentView): void {
  event.preventDefault()
  selectedId.value = agent.id
  menuTarget.value = agent
  menuX.value = event.clientX
  menuY.value = event.clientY
  menuOpen.value = true
}

function closeAgentMenu(): void {
  menuOpen.value = false
  menuTarget.value = null
}

function onMenuSelect(id: string): void {
  const agent = menuTarget.value
  if (!agent) return
  if (id === 'edit') {
    void requestEdit(agent)
    return
  }
  if (id === 'delete') {
    selectedId.value = agent.id
    deleteConfirmOpen.value = true
  }
}

function openEditDialog(agent: AgentView): void {
  editingAgent.value = agent
  editOpen.value = true
}

async function requestEdit(agent: AgentView): Promise<void> {
  checkingEditUsage.value = true
  try {
    const [chats, providerList] = await Promise.all([agentChatApi.list(), providerApi.list()])
    providers.value = providerList
    const usedCount = chats.filter((chat) => chat.agentId === agent.id).length
    if (usedCount > 0) {
      pendingEditAgent.value = agent
      pendingEditChatCount.value = usedCount
      editConfirmOpen.value = true
      return
    }
    openEditDialog(agent)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '检查 Agent 使用情况失败'
  } finally {
    checkingEditUsage.value = false
  }
}

function closeEditConfirm(): void {
  editConfirmOpen.value = false
  pendingEditAgent.value = null
  pendingEditChatCount.value = 0
}

function confirmEditUsedAgent(): void {
  const agent = pendingEditAgent.value
  closeEditConfirm()
  if (agent) openEditDialog(agent)
}

function closeEditDialog(): void {
  editOpen.value = false
  editingAgent.value = null
}

async function onDelete(): Promise<void> {
  const agent = selected.value
  if (!agent) return
  deleting.value = true
  try {
    await agentApi.delete(agent.id)
    deleteConfirmOpen.value = false
    selectedId.value = null
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '删除失败'
  } finally {
    deleting.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-1 h-full min-w-0">
    <!-- left: agent list -->
    <div class="w-[280px] flex-shrink-0 border-r border-surface-border bg-surface flex flex-col">
      <header
        class="h-16 px-4 flex items-center justify-between border-b border-surface-border flex-shrink-0"
      >
        <h1 class="font-semibold text-text-main text-lg">Agent 管理</h1>
        <BaseButton size="sm" @click="openCreateDialog">
          <span class="material-symbols-outlined text-xl">add</span>
          新建
        </BaseButton>
      </header>
      <div class="flex-1 overflow-y-auto p-2">
        <div v-if="loading" class="space-y-1">
          <div v-for="i in 5" :key="i" class="px-3 py-2.5">
            <div class="flex items-center gap-2">
              <BaseSkeleton class="w-6 h-6 flex-shrink-0" rounded="full" />
              <BaseSkeleton class="h-3.5 w-1/2" />
            </div>
            <BaseSkeleton class="h-3 w-1/3 mt-2 ml-8" />
          </div>
        </div>
        <p v-else-if="agents.length === 0" class="text-center text-text-muted text-sm py-6">
          还没有 Agent，点击「新建」创建一个。
        </p>
        <button
          v-for="agent in agents"
          :key="agent.id"
          type="button"
          class="w-full text-left px-3 py-2.5 rounded-md mb-1 transition-colors"
          :class="agent.id === selectedId ? 'bg-surface-active' : 'hover:bg-surface-hover'"
          @click="selectedId = agent.id"
          @contextmenu="openAgentMenu($event, agent)"
        >
          <div class="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5">
            <AgentAvatar
              :name="agent.name"
              :avatar="agent.avatar"
              :color="agent.color"
              size="sm"
              class="row-span-2"
            />
            <span class="min-w-0 text-base font-medium leading-5 text-text-main truncate">{{
              agent.name
            }}</span>
            <div class="col-start-2 flex min-w-0 items-center gap-1.5">
              <span
                class="inline-flex max-w-full items-center rounded-sm border px-1.5 py-[1px] text-xs font-medium leading-4 truncate"
                :class="vendorTagClass(agent.vendor)"
              >
                {{ vendorLabel(agent.vendor) }}
              </span>
              <span
                class="inline-flex min-w-0 max-w-[8.75rem] items-center rounded-sm border border-surface-border bg-surface-hover px-1.5 py-[1px] text-xs font-medium leading-4 text-gray-600 truncate"
              >
                {{ agent.model }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>

    <!-- right: detail -->
    <div class="flex-1 min-w-0 bg-background overflow-y-auto">
      <div v-if="selected" class="max-w-[720px] mx-auto p-6">
        <div class="flex items-start justify-between mb-6">
          <div class="flex min-w-0 items-center gap-3">
            <AgentAvatar
              :name="selected.name"
              :avatar="selected.avatar"
              :color="selected.color"
              size="lg"
            />
            <div class="min-w-0">
              <h2 class="text-2xl font-semibold text-text-main truncate">{{ selected.name }}</h2>
              <p class="text-sm text-text-muted mt-1">
                {{ vendorLabel(selected.vendor) }} · {{ selected.model }}
              </p>
            </div>
          </div>
          <BaseButton
            variant="danger"
            size="sm"
            :disabled="deleting"
            @click="deleteConfirmOpen = true"
          >
            <span class="material-symbols-outlined text-xl">delete</span>
            删除
          </BaseButton>
        </div>

        <section
          class="bg-surface rounded-lg border border-surface-border divide-y divide-surface-border"
        >
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Vendor</span>
            <span class="text-base text-text-main">{{ vendorLabel(selected.vendor) }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">头像</span>
            <span class="text-base text-text-main">{{
              selected.avatar ? '自定义头像' : '默认头像'
            }}</span>
          </div>
          <div class="flex items-center px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">颜色标识</span>
            <span
              class="mr-2 h-4 w-4 rounded border border-surface-border"
              :style="{ backgroundColor: selected.color }"
            ></span>
            <span class="text-base text-text-main font-mono">{{ selected.color }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">模型</span>
            <span class="text-base text-text-main">{{ selected.model }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">PlatformProvider</span>
            <span class="text-base text-text-main">{{
              providerName(selected.platformProviderId)
            }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Agent Home</span>
            <span class="text-base text-text-main font-mono break-all">{{
              selected.agentHomeDirectory
            }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">工作目录</span>
            <span class="text-base text-text-main font-mono break-all">{{
              selected.workingDirectory
            }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">能力摘要</span>
            <span class="whitespace-pre-wrap break-words text-base text-text-main">{{
              selected.capabilitySummary || '—'
            }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">能力</span>
            <span class="text-base text-text-main">
              {{
                [
                  selected.capabilities.supportsSystemPrompt ? 'systemPrompt' : null,
                  selected.capabilities.supportsSkills ? 'skills' : null,
                  selected.capabilities.supportsMcp ? 'mcp' : null
                ]
                  .filter(Boolean)
                  .join(', ') || '—'
              }}
            </span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Skills</span>
            <span class="text-base text-text-main break-all">{{ skillsText(selected) }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">MCP</span>
            <span class="text-base text-text-main break-all">{{ mcpText(selected) }}</span>
          </div>
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Allowed Tools</span>
            <span class="text-base text-text-main break-all">{{ toolsText(selected) }}</span>
          </div>
        </section>

        <section class="mt-4">
          <h3 class="text-sm text-text-muted mb-1.5">System Prompt</h3>
          <pre
            class="bg-surface rounded-lg border border-surface-border p-4 text-base text-text-main whitespace-pre-wrap break-words font-mono min-h-[64px]"
            >{{ selected.systemPrompt || '—' }}</pre
          >
        </section>
      </div>

      <div v-else class="h-full flex items-center justify-center text-text-muted text-base">
        {{ loading ? '加载中…' : '选择左侧的 Agent 查看详情' }}
      </div>
    </div>

    <p
      v-if="error"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-danger-soft text-danger-strong text-sm px-4 py-2 rounded-md border border-danger-border z-50"
    >
      {{ error }}
    </p>

    <AgentCreateDialog
      :open="createOpen"
      :providers="providers"
      @close="createOpen = false"
      @created="onCreated"
    />
    <AgentCreateDialog
      :open="editOpen"
      :providers="providers"
      :agent="editingAgent"
      @close="closeEditDialog"
      @updated="onUpdated"
    />
    <ConfirmDialog
      :open="editConfirmOpen"
      title="Agent 已被使用"
      :message="
        pendingEditAgent
          ? `Agent「${pendingEditAgent.name}」已经被 ${pendingEditChatCount} 个会话使用。编辑配置可能影响后续对话和重新进入的运行实例，是否继续编辑？`
          : ''
      "
      confirm-label="继续编辑"
      confirm-variant="primary"
      @close="closeEditConfirm"
      @confirm="confirmEditUsedAgent"
    />
    <ConfirmDialog
      :open="deleteConfirmOpen"
      title="删除 Agent"
      :message="selected ? `确认删除 Agent「${selected.name}」？其会话也将一并删除。` : ''"
      confirm-label="删除"
      confirming-label="删除中..."
      :confirming="deleting"
      @close="deleteConfirmOpen = false"
      @confirm="onDelete"
    />
    <ContextMenu
      :open="menuOpen"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      @select="onMenuSelect"
      @close="closeAgentMenu"
    />
  </div>
</template>
