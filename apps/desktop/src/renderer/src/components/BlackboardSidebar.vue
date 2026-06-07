<script setup lang="ts">
import { computed } from 'vue'
import type { BlackboardView } from '../api'
import { shouldShowBlackboardArtifact } from '../utils/blackboard'

const props = defineProps<{ blackboard: BlackboardView | null; loading?: boolean }>()

const taskTone: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600',
  ready: 'bg-primary-soft text-primary',
  doing: 'bg-warning-soft text-warning',
  done: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger'
}

const visibleArtifacts = computed(
  () => props.blackboard?.artifacts.filter(shouldShowBlackboardArtifact) ?? []
)
</script>

<template>
  <aside
    class="flex h-full w-[300px] flex-shrink-0 flex-col border-l border-surface-border bg-surface"
  >
    <header class="flex h-12 items-center gap-1.5 border-b border-surface-border px-4">
      <span class="material-symbols-outlined text-2xl text-text-muted">dashboard</span>
      <h3 class="text-md font-semibold text-text-main">黑板</h3>
    </header>
    <div class="flex-1 space-y-5 overflow-y-auto p-4">
      <p v-if="loading" class="text-sm text-text-muted">加载中…</p>
      <template v-else-if="blackboard">
        <!-- Tasks -->
        <section>
          <h4 class="mb-2 text-sm font-semibold text-text-muted">任务图</h4>
          <p v-if="blackboard.taskGraph.length === 0" class="text-sm text-gray-400">暂无任务</p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="t in blackboard.taskGraph"
              :key="t.id"
              class="flex items-center justify-between gap-2 rounded-md bg-surface-hover px-2.5 py-1.5"
            >
              <span class="min-w-0 flex-1 truncate text-base text-text-main">{{ t.name }}</span>
              <span
                class="flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                :class="taskTone[t.status] ?? 'bg-gray-100 text-gray-600'"
              >
                {{ t.status }}
              </span>
            </li>
          </ul>
        </section>

        <!-- Artifacts -->
        <section>
          <h4 class="mb-2 text-sm font-semibold text-text-muted">产出物</h4>
          <p v-if="visibleArtifacts.length === 0" class="text-sm text-gray-400">暂无产出物</p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="a in visibleArtifacts"
              :key="a.id"
              class="rounded-md bg-surface-hover px-2.5 py-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 flex-1 truncate font-mono text-sm text-text-main">{{
                  a.path
                }}</span>
                <span class="flex-shrink-0 text-xs text-text-muted">v{{ a.version }}</span>
              </div>
              <p class="mt-0.5 truncate text-xs text-text-muted">{{ a.summary }}</p>
            </li>
          </ul>
        </section>

        <!-- Decisions -->
        <section>
          <h4 class="mb-2 text-sm font-semibold text-text-muted">决策</h4>
          <p v-if="blackboard.decisions.length === 0" class="text-sm text-gray-400">暂无决策</p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="d in blackboard.decisions"
              :key="d.id"
              class="rounded-md bg-surface-hover px-2.5 py-1.5"
            >
              <p
                class="text-base text-text-main"
                :class="d.status === 'superseded' ? 'line-through opacity-60' : ''"
              >
                {{ d.content }}
              </p>
              <span class="text-xs text-text-muted">{{ d.status }}</span>
            </li>
          </ul>
        </section>

        <!-- Contracts -->
        <section>
          <h4 class="mb-2 text-sm font-semibold text-text-muted">契约</h4>
          <p v-if="blackboard.contracts.length === 0" class="text-sm text-gray-400">暂无契约</p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="c in blackboard.contracts"
              :key="c.id"
              class="rounded-md bg-surface-hover px-2.5 py-1.5"
            >
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-sm text-text-main">{{ c.id }}</span>
                <span
                  v-if="c.approvalRequired"
                  class="material-symbols-outlined text-md text-warning"
                  title="需审批"
                  >lock</span
                >
              </div>
              <span class="text-xs text-text-muted">owner: {{ c.ownerAgentId }}</span>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </aside>
</template>
