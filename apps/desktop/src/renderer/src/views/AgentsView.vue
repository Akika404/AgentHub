<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { AgentRuntimeStatus, AgentView, PlatformProviderView } from '@agenthub/shared'
import { ApiError, agentApi, providerApi } from '../api'
import AgentCreateDialog from '../components/AgentCreateDialog.vue'

const agents = ref<AgentView[]>([])
const providers = ref<PlatformProviderView[]>([])
const selectedId = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const createOpen = ref(false)
const deleting = ref(false)

const selected = computed(() => agents.value.find((a) => a.id === selectedId.value) ?? null)

const STATUS_LABELS: Record<AgentRuntimeStatus, string> = {
  active: '会话进行中',
  suspended: '已暂存',
  cleared: '已清空',
  none: '未开始会话'
}

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

async function onDelete(): Promise<void> {
  const agent = selected.value
  if (!agent) return
  if (!window.confirm(`确认删除 Agent「${agent.name}」？其会话也将一并删除。`)) return
  deleting.value = true
  try {
    await agentApi.delete(agent.id)
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
        <button
          type="button"
          class="flex items-center gap-1 h-8 px-3 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-sm font-medium transition-colors"
          @click="createOpen = true"
        >
          <span class="material-symbols-outlined text-xl">add</span>
          新建
        </button>
      </header>
      <div class="flex-1 overflow-y-auto p-2">
        <p v-if="loading" class="text-center text-text-muted text-sm py-6">加载中…</p>
        <p v-else-if="agents.length === 0" class="text-center text-text-muted text-sm py-6">
          还没有 Agent，点击「新建」创建一个。
        </p>
        <button
          v-for="agent in agents"
          :key="agent.id"
          type="button"
          class="w-full text-left px-3 py-2.5 rounded-[8px] mb-1 transition-colors"
          :class="agent.id === selectedId ? 'bg-surface-active' : 'hover:bg-surface-hover'"
          @click="selectedId = agent.id"
        >
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-2xl text-primary">smart_toy</span>
            <span class="flex-1 text-base font-medium text-text-main truncate">{{
              agent.name
            }}</span>
          </div>
          <div class="flex items-center gap-2 mt-1 pl-6">
            <span class="text-xs text-text-muted">{{ agent.vendor }}</span>
            <span class="text-xs text-text-muted">·</span>
            <span class="text-xs text-text-muted">{{ STATUS_LABELS[agent.status] }}</span>
          </div>
        </button>
      </div>
    </div>

    <!-- right: detail -->
    <div class="flex-1 min-w-0 bg-background overflow-y-auto">
      <div v-if="selected" class="max-w-[720px] mx-auto p-6">
        <div class="flex items-start justify-between mb-6">
          <div>
            <h2 class="text-2xl font-semibold text-text-main">{{ selected.name }}</h2>
            <p class="text-sm text-text-muted mt-1">
              {{ selected.vendor }} · {{ STATUS_LABELS[selected.status] }}
            </p>
          </div>
          <button
            type="button"
            :disabled="deleting"
            class="flex items-center gap-1 h-9 px-3 rounded-[8px] border border-surface-border text-danger hover:bg-danger-soft text-sm font-medium transition-colors disabled:opacity-60"
            @click="onDelete"
          >
            <span class="material-symbols-outlined text-xl">delete</span>
            删除
          </button>
        </div>

        <section
          class="bg-surface rounded-[10px] border border-surface-border divide-y divide-surface-border"
        >
          <div class="flex px-4 py-3">
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Vendor</span>
            <span class="text-base text-text-main">{{ selected.vendor }}</span>
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
            <span class="w-32 flex-shrink-0 text-sm text-text-muted">Agent 目录</span>
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
            class="bg-surface rounded-[10px] border border-surface-border p-4 text-base text-text-main whitespace-pre-wrap break-words font-mono min-h-[64px]"
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
      class="fixed bottom-4 left-1/2 -translate-x-1/2 bg-danger-soft text-danger-strong text-sm px-4 py-2 rounded-[8px] border border-danger-border z-50"
    >
      {{ error }}
    </p>

    <AgentCreateDialog
      :open="createOpen"
      :providers="providers"
      @close="createOpen = false"
      @created="onCreated"
    />
  </div>
</template>
