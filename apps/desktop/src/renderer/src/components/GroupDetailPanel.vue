<script setup lang="ts">
import { computed } from 'vue'
import type { BlackboardTaskStatus, BlackboardView, GroupChatView, GroupMemberView } from '../api'
import { vendorLabel } from '../utils/vendor'
import AgentAvatar from './AgentAvatar.vue'
import GroupAvatar from './GroupAvatar.vue'

const props = withDefaults(
  defineProps<{
    group: GroupChatView | null
    blackboard: BlackboardView | null
    loading?: boolean
    blackboardLoading?: boolean
    mode?: 'page' | 'inspector'
  }>(),
  {
    mode: 'page'
  }
)

const taskTone: Record<BlackboardTaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  ready: 'bg-primary-soft text-primary',
  doing: 'bg-warning-soft text-warning',
  done: 'bg-success-soft text-success',
  failed: 'bg-danger-soft text-danger',
  blocked: 'bg-gray-100 text-gray-500'
}

function memberRole(member: GroupMemberView): string {
  return member.roleInGroup?.trim() || vendorLabel(member.vendor)
}

const isInspector = computed(() => props.mode === 'inspector')
const bodyGridClass = computed(() =>
  isInspector.value ? 'grid-cols-1' : 'xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]'
)
const memberGridClass = computed(() =>
  isInspector.value ? 'grid-cols-1' : 'sm:grid-cols-2 2xl:grid-cols-3'
)
const headerClass = computed(() => (isInspector.value ? 'h-16 px-5' : 'px-6 py-5'))
const avatarSize = computed(() => (isInspector.value ? 'md' : 'lg'))
const titleClass = computed(() => (isInspector.value ? 'text-lg' : 'text-xl'))
</script>

<template>
  <main
    class="flex min-w-0 flex-col bg-surface"
    :class="isInspector ? 'flex-shrink-0 border-l border-surface-border' : 'flex-1'"
  >
    <template v-if="loading">
      <div class="flex flex-1 items-center justify-center text-text-muted">正在加载群聊资料…</div>
    </template>

    <template v-else-if="group">
      <header
        class="flex flex-shrink-0 items-center border-b border-surface-border"
        :class="headerClass"
      >
        <div class="flex min-w-0 flex-1 items-center gap-4">
          <GroupAvatar :members="group.members" :title="group.title" :size="avatarSize" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate font-semibold text-text-main" :class="titleClass">
                {{ group.title }}
              </h2>
              <span
                class="flex-shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary"
              >
                群聊
              </span>
            </div>
            <div class="mt-1 truncate text-sm text-text-muted">
              {{ group.members.length }} 个 Agent · {{ group.projectMeta.name }}
            </div>
          </div>
          <span
            v-if="group.activeRunId"
            class="flex items-center gap-1.5 rounded bg-success-soft px-2 py-1 text-sm font-medium text-success"
          >
            <span class="h-2 w-2 rounded-full bg-success"></span>
            运行中
          </span>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div class="grid gap-5" :class="bodyGridClass">
          <div class="space-y-5">
            <section>
              <div class="mb-3 flex items-center gap-2">
                <span class="material-symbols-outlined text-2xl text-text-muted">flag</span>
                <h3 class="text-md font-semibold text-text-main">目标</h3>
              </div>
              <div class="rounded-md border border-surface-border bg-surface-hover px-4 py-3">
                <div class="text-sm font-medium text-text-muted">项目目标</div>
                <p class="mt-1 whitespace-pre-wrap text-base leading-6 text-text-main">
                  {{ group.projectMeta.goal || '暂未设置目标' }}
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <span
                    class="rounded bg-white px-2 py-1 text-xs font-medium text-text-muted shadow-sm"
                  >
                    {{ group.projectMeta.status }}
                  </span>
                  <span
                    v-for="tech in group.projectMeta.techStack"
                    :key="tech"
                    class="rounded bg-white px-2 py-1 text-xs font-medium text-text-main shadow-sm"
                  >
                    {{ tech }}
                  </span>
                </div>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center gap-2">
                <span class="material-symbols-outlined text-2xl text-text-muted">groups</span>
                <h3 class="text-md font-semibold text-text-main">群成员</h3>
              </div>
              <div class="grid gap-2" :class="memberGridClass">
                <div
                  v-for="member in group.members"
                  :key="member.agentId"
                  class="flex min-w-0 items-center gap-3 rounded-md border border-surface-border bg-white px-3 py-2.5"
                >
                  <AgentAvatar
                    :name="member.name"
                    :avatar="member.avatar"
                    :color="member.color"
                    size="sm"
                  />
                  <div class="min-w-0">
                    <div class="truncate text-base font-medium text-text-main">
                      {{ member.name }}
                    </div>
                    <div class="truncate text-sm text-text-muted">{{ memberRole(member) }}</div>
                    <p
                      v-if="member.capabilitySummary"
                      class="mt-1 line-clamp-2 text-sm leading-5 text-text-muted"
                    >
                      {{ member.capabilitySummary }}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center gap-2">
                <span class="material-symbols-outlined text-2xl text-text-muted">dashboard</span>
                <h3 class="text-md font-semibold text-text-main">黑板任务</h3>
              </div>
              <p v-if="blackboardLoading" class="text-sm text-text-muted">黑板加载中…</p>
              <p
                v-else-if="!blackboard || blackboard.taskGraph.length === 0"
                class="text-sm text-text-muted"
              >
                暂无任务
              </p>
              <div v-else class="space-y-2">
                <div
                  v-for="task in blackboard.taskGraph"
                  :key="task.id"
                  class="rounded-md border border-surface-border bg-white px-3 py-2.5"
                >
                  <div class="flex items-start justify-between gap-3">
                    <div class="min-w-0">
                      <div class="truncate text-base font-medium text-text-main">
                        {{ task.name }}
                      </div>
                      <p class="mt-1 line-clamp-2 text-sm text-text-muted">
                        {{ task.objective }}
                      </p>
                    </div>
                    <span
                      class="flex-shrink-0 rounded px-1.5 py-0.5 text-xs font-medium"
                      :class="taskTone[task.status]"
                    >
                      {{ task.status }}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <aside class="space-y-5">
            <section class="rounded-md border border-surface-border bg-white p-4">
              <h3 class="mb-3 text-md font-semibold text-text-main">群设置</h3>
              <div class="space-y-3 text-sm">
                <div>
                  <div class="font-medium text-text-muted">Orchestrator</div>
                  <div class="mt-0.5 break-words text-text-main">
                    {{ vendorLabel(group.orchestrator.vendor) }} / {{ group.orchestrator.model }}
                  </div>
                </div>
                <div>
                  <div class="font-medium text-text-muted">Workspace</div>
                  <div class="mt-0.5 break-all font-mono text-xs text-text-main">
                    {{ group.workspaceDir }}
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-md border border-surface-border bg-white p-4">
              <h3 class="mb-3 text-md font-semibold text-text-main">产出物</h3>
              <p
                v-if="!blackboard || blackboard.artifacts.length === 0"
                class="text-sm text-text-muted"
              >
                暂无产出物
              </p>
              <div v-else class="space-y-2">
                <div v-for="artifact in blackboard.artifacts" :key="artifact.id">
                  <div class="truncate font-mono text-sm text-text-main">{{ artifact.path }}</div>
                  <div class="truncate text-xs text-text-muted">
                    v{{ artifact.version }} · {{ artifact.status }}
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-md border border-surface-border bg-white p-4">
              <h3 class="mb-3 text-md font-semibold text-text-main">决策</h3>
              <p
                v-if="!blackboard || blackboard.decisions.length === 0"
                class="text-sm text-text-muted"
              >
                暂无决策
              </p>
              <div v-else class="space-y-2">
                <div v-for="decision in blackboard.decisions" :key="decision.id">
                  <p class="line-clamp-2 text-sm text-text-main">{{ decision.content }}</p>
                  <div class="mt-0.5 text-xs text-text-muted">{{ decision.status }}</div>
                </div>
              </div>
            </section>

            <section class="rounded-md border border-surface-border bg-white p-4">
              <h3 class="mb-3 text-md font-semibold text-text-main">契约</h3>
              <p
                v-if="!blackboard || blackboard.contracts.length === 0"
                class="text-sm text-text-muted"
              >
                暂无契约
              </p>
              <div v-else class="space-y-2">
                <div
                  v-for="contract in blackboard.contracts"
                  :key="contract.id"
                  class="flex items-center justify-between gap-2 text-sm"
                >
                  <span class="min-w-0 truncate font-mono text-text-main">{{ contract.id }}</span>
                  <span class="flex-shrink-0 text-xs text-text-muted">v{{ contract.version }}</span>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="flex flex-1 items-center justify-center text-text-muted">
        从左侧选择或创建一个群聊
      </div>
    </template>
  </main>
</template>
