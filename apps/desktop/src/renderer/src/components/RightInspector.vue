<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentChatView, AgentTodoItem, NetworkNode, NetworkNodeStatus } from '../api'
import AgentAvatar from './AgentAvatar.vue'
import { vendorLabel } from '../utils/vendor'

const props = defineProps<{
  network: NetworkNode[]
  chat?: AgentChatView | null
  runtime?: {
    phase: 'idle' | 'thinking' | 'tool' | 'streaming' | 'error' | 'done'
    label: string
    detail?: string
    toolName?: string
    todos: AgentTodoItem[]
  }
}>()

type Tab = 'status' | 'workspace'
const tab = ref<Tab>('status')

interface TreeNode extends NetworkNode {
  children: TreeNode[]
}

const tree = computed<TreeNode[]>(() => {
  const map = new Map<string, TreeNode>()
  props.network.forEach((n) => map.set(n.id, { ...n, children: [] }))
  const roots: TreeNode[] = []
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
})

const dotClasses: Record<NetworkNodeStatus, string> = {
  active: 'bg-success',
  working: 'bg-primary',
  idle: 'bg-surface-border'
}

const phaseClasses = computed(() => {
  switch (props.runtime?.phase) {
    case 'thinking':
    case 'streaming':
      return 'bg-primary'
    case 'tool':
      return 'bg-warning'
    case 'error':
      return 'bg-danger'
    case 'done':
      return 'bg-success'
    default:
      return 'bg-surface-border'
  }
})

function todoLabel(status: AgentTodoItem['status']): string {
  const labels: Record<AgentTodoItem['status'], string> = {
    pending: 'Pending',
    in_progress: 'In progress',
    completed: 'Done'
  }
  return labels[status]
}
</script>

<template>
  <aside
    class="w-[300px] h-full border-l border-surface-border bg-surface flex flex-col flex-shrink-0 z-10"
  >
    <div class="flex p-1 bg-surface-hover m-4 rounded">
      <button
        class="flex-1 py-1 text-base font-medium rounded-sm transition-all"
        :class="
          tab === 'status'
            ? 'bg-white text-text-main shadow-sm'
            : 'text-text-muted hover:text-text-main'
        "
        @click="tab = 'status'"
      >
        Status
      </button>
      <button
        class="flex-1 py-1 text-base font-medium rounded-sm transition-all"
        :class="
          tab === 'workspace'
            ? 'bg-white text-text-main shadow-sm'
            : 'text-text-muted hover:text-text-main'
        "
        @click="tab = 'workspace'"
      >
        WorkSpace
      </button>
    </div>

    <div v-if="tab === 'status'" class="flex-1 overflow-y-auto px-5 py-2">
      <template v-if="chat">
        <div class="pb-5 border-b border-surface-border">
          <div class="flex items-center space-x-3">
            <AgentAvatar
              :name="chat.agent.name"
              :avatar="chat.agent.avatar"
              :color="chat.agent.color"
            />
            <div class="min-w-0">
              <div class="text-md font-semibold text-text-main truncate">{{ chat.agent.name }}</div>
              <div class="text-sm text-text-muted truncate">
                {{ vendorLabel(chat.agent.vendor) }} / {{ chat.agent.model }}
              </div>
            </div>
          </div>
        </div>

        <div class="py-5 border-b border-surface-border">
          <div class="text-md font-semibold text-text-main mb-3">运行状态</div>
          <div class="flex items-center space-x-2.5">
            <span
              class="w-3 h-3 rounded-full flex-shrink-0"
              :class="[phaseClasses, runtime?.phase === 'streaming' ? 'animate-pulse-ring' : '']"
            ></span>
            <span class="text-base font-medium text-text-main">{{ runtime?.label ?? 'Idle' }}</span>
          </div>
          <div v-if="runtime?.toolName" class="mt-3 text-sm text-text-muted break-words">
            {{ runtime.toolName }}
          </div>
          <div v-if="runtime?.detail" class="mt-3 text-sm text-text-muted break-words line-clamp-5">
            {{ runtime.detail }}
          </div>
        </div>

        <div class="py-5">
          <div class="text-md font-semibold text-text-main mb-3">任务</div>
          <div v-if="!runtime?.todos.length" class="text-base text-text-muted">暂无任务</div>
          <div v-else class="space-y-2">
            <div
              v-for="(todo, index) in runtime.todos"
              :key="`${todo.text}-${index}`"
              class="flex items-start space-x-2"
            >
              <span
                class="material-symbols-outlined text-xl mt-0.5"
                :class="
                  todo.status === 'completed'
                    ? 'text-success'
                    : todo.status === 'in_progress'
                      ? 'text-primary'
                      : 'text-text-muted'
                "
              >
                {{
                  todo.status === 'completed'
                    ? 'check_circle'
                    : todo.status === 'in_progress'
                      ? 'radio_button_checked'
                      : 'radio_button_unchecked'
                }}
              </span>
              <div class="min-w-0">
                <div
                  class="text-base break-words"
                  :class="
                    todo.status === 'completed'
                      ? 'text-text-muted line-through'
                      : todo.status === 'in_progress'
                        ? 'text-text-main font-medium'
                        : 'text-text-main'
                  "
                >
                  {{ todo.text }}
                </div>
                <div class="text-sm text-text-muted">{{ todoLabel(todo.status) }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="text-md font-semibold text-text-main mb-5">当前协作网络</div>
        <div v-if="!tree.length" class="text-base text-text-muted">暂无协作节点</div>
        <div class="space-y-1">
          <template v-for="root in tree" :key="root.id">
            <div class="flex items-center space-x-2.5 py-1">
              <div
                class="w-3 h-3 rounded-full flex-shrink-0"
                :class="[
                  dotClasses[root.status],
                  root.status === 'active' ? 'animate-pulse-ring' : ''
                ]"
              ></div>
              <span class="text-md font-medium text-text-main">{{ root.name }}</span>
            </div>
            <div
              v-if="root.children.length"
              class="ml-[6px] pl-[14px] border-l border-surface-border space-y-1"
            >
              <div v-for="child in root.children" :key="child.id">
                <div class="flex items-center space-x-2.5 py-1">
                  <span
                    class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    :class="dotClasses[child.status]"
                  ></span>
                  <span class="text-base text-text-main">{{ child.name }}</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </template>
    </div>

    <div v-else class="flex-1 overflow-y-auto px-5 py-2 text-base">
      <template v-if="chat">
        <div class="space-y-4">
          <div>
            <div class="text-sm font-medium text-text-muted mb-1">Working Directory</div>
            <div class="text-text-main break-all">{{ chat.workingDirectory }}</div>
          </div>
          <div>
            <div class="text-sm font-medium text-text-muted mb-1">Chat Home</div>
            <div class="text-text-main break-all">{{ chat.sessionHomeDirectory }}</div>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="text-text-muted">WorkSpace 暂未实现</div>
      </template>
    </div>
  </aside>
</template>
