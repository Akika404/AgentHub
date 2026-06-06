<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentTodoItem } from '../../api'
import type { AgentRunMessage, AgentRunStep } from '../../types/chatDisplay'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: AgentRunMessage }>()

const expanded = ref(false)

const hasText = computed(() => props.message.text.trim().length > 0)
// 取最后一条快照：todo 每次更新都作为全量快照，历史数据里可能存有多条，
// 最新的那条才是最终状态（旧逻辑取 find 第一条会退化成只含首个 pending 任务）。
const planStep = computed(() => props.message.steps.filter((step) => step.type === 'todo').at(-1))
const planTodos = computed<AgentTodoItem[]>(() => planStep.value?.todos ?? [])
const planDocStep = computed(() =>
  props.message.steps.filter((step) => step.type === 'plan').at(-1)
)
const planDoc = computed(() => planDocStep.value?.text?.trim() ?? '')
const visibleSteps = computed(() =>
  props.message.steps.filter((step) => step.type !== 'todo' && step.type !== 'plan')
)
const activeStep = computed(() => props.message.steps.find((step) => step.status === 'active'))
const completedCount = computed(
  () => visibleSteps.value.filter((step) => step.status !== 'active').length
)
const hasPlan = computed(() => planTodos.value.length > 0 || planDoc.value.length > 0)
const isInitialThinking = computed(
  () =>
    !hasText.value &&
    !hasPlan.value &&
    props.message.status === 'thinking' &&
    visibleSteps.value.length === 1 &&
    visibleSteps.value[0]?.type === 'thinking' &&
    visibleSteps.value[0]?.status === 'active' &&
    visibleSteps.value[0]?.label === '思考中'
)
const showRunPanel = computed(
  () => visibleSteps.value.length > 0 && (expanded.value || (!hasText.value && !hasPlan.value))
)
// 有计划卡片时，运行过程默认折叠，仅保留可展开的切换按钮，让计划成为视觉焦点。
const showRunToggle = computed(
  () => visibleSteps.value.length > 0 && (hasText.value || hasPlan.value)
)
const terminalLabel = computed(() =>
  props.message.status === 'error' ? '运行失败' : '运行完成，未返回文本'
)
const terminalIcon = computed(() => (props.message.status === 'error' ? 'error' : 'check'))

function stepIcon(step: AgentRunStep): string {
  if (step.status === 'failed') return 'error'
  if (step.status === 'completed') return 'check'
  if (step.type === 'tool') return 'build'
  if (step.type === 'progress') return 'notes'
  return 'more_horiz'
}

function formatPayload(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolCommand(step: AgentRunStep): string {
  if (!step.input || typeof step.input !== 'object') return ''
  const command = (step.input as { command?: unknown }).command
  return typeof command === 'string' ? command : ''
}

function stepInput(step: AgentRunStep): string {
  if (step.type !== 'tool') return ''
  const command = toolCommand(step)
  if (command) return command
  return formatPayload(step.input)
}

function stepOutput(step: AgentRunStep): string {
  if (step.type !== 'tool') return ''
  return formatPayload(step.output)
}

function todoStatusLabel(status: AgentTodoItem['status']): string {
  const labels: Record<AgentTodoItem['status'], string> = {
    pending: '待办',
    in_progress: '进行中',
    completed: '已完成'
  }
  return labels[status]
}
</script>

<template>
  <div class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%]">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-sm font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-sm text-text-muted">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface-hover border border-surface-border p-3 rounded-xl rounded-tl-sm text-md whitespace-pre-wrap break-words"
        :class="{
          'w-72 max-w-full': isInitialThinking,
          'w-96 max-w-full': hasPlan && !isInitialThinking
        }"
      >
        <div
          v-if="planDoc"
          class="mb-3 overflow-hidden rounded-sm border border-surface-border bg-white/70"
        >
          <div
            class="flex items-center space-x-1.5 border-b border-surface-border px-2.5 py-1.5 text-xs font-medium text-text-muted"
          >
            <span class="material-symbols-outlined text-lg">description</span>
            <span>计划</span>
          </div>
          <div
            class="px-2.5 py-2 text-sm leading-[20px] whitespace-pre-wrap break-words text-text-main"
            v-text="planDoc"
          ></div>
        </div>

        <div
          v-if="planTodos.length"
          class="mb-3 overflow-hidden rounded-sm border border-surface-border bg-white/70"
        >
          <div
            class="flex items-center space-x-1.5 border-b border-surface-border px-2.5 py-1.5 text-xs font-medium text-text-muted"
          >
            <span class="material-symbols-outlined text-lg">checklist</span>
            <span>{{ planStep?.label ?? '计划' }}</span>
          </div>
          <div
            v-for="(todo, index) in planTodos"
            :key="`${todo.text}-${index}`"
            class="flex items-start space-x-2 border-b border-surface-border/70 px-2.5 py-2 text-sm last:border-b-0"
          >
            <span
              v-if="todo.status === 'in_progress'"
              class="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-[2px] border-primary bg-white"
            >
              <span class="h-[8px] w-[8px] rounded-full bg-primary"></span>
            </span>
            <span
              v-else-if="todo.status === 'completed'"
              class="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-primary text-white"
            >
              <span class="material-symbols-outlined text-md">check</span>
            </span>
            <span
              v-else
              class="mt-0.5 h-[18px] w-[18px] flex-shrink-0 rounded-full border-[2px] border-surface-border bg-white"
            ></span>
            <div class="min-w-0 flex-1">
              <div
                class="break-words"
                :class="
                  todo.status === 'completed'
                    ? 'text-text-muted line-through'
                    : todo.status === 'in_progress'
                      ? 'font-medium text-text-main'
                      : 'text-text-main'
                "
              >
                {{ todo.text }}
              </div>
              <div class="text-xs text-text-muted">{{ todoStatusLabel(todo.status) }}</div>
            </div>
          </div>
        </div>

        <button
          v-if="showRunToggle"
          type="button"
          class="mb-2 flex w-full items-center justify-between rounded-sm border border-surface-border bg-white/70 px-2.5 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-white hover:text-text-main"
          @click="expanded = !expanded"
        >
          <span>
            运行过程 · {{ completedCount }} 步
            <span v-if="activeStep"> · {{ activeStep.label }}</span>
          </span>
          <span
            class="material-symbols-outlined text-xl transition-transform duration-200 ease-soft"
            :class="{ 'rotate-180': expanded }"
            >expand_more</span
          >
        </button>

        <div
          v-if="!hasText && !visibleSteps.length && !planTodos.length && !planDoc"
          class="flex h-[22px] items-center"
        >
          <div class="flex min-w-0 items-center space-x-1.5 text-text-muted">
            <span class="material-symbols-outlined text-lg">{{ terminalIcon }}</span>
            <span class="truncate">{{ terminalLabel }}</span>
          </div>
        </div>

        <Transition name="run-panel">
          <div
            v-if="showRunPanel"
            class="mb-3 overflow-hidden rounded-sm border border-surface-border bg-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
          >
            <div
              v-if="!hasText && !isInitialThinking"
              class="flex items-center justify-between border-b border-surface-border px-2.5 py-1.5 text-xs font-medium text-text-muted"
            >
              <span>运行过程</span>
              <span v-if="activeStep" class="truncate pl-3">{{ activeStep.label }}</span>
            </div>
            <div
              v-for="step in visibleSteps"
              :key="step.id"
              class="border-b border-surface-border/70 px-2.5 py-2 text-sm last:border-b-0"
              :class="[
                step.status === 'active' ? 'bg-white/70 text-text-main' : 'text-text-muted',
                step.status === 'failed' ? 'text-danger-strong' : ''
              ]"
            >
              <div class="flex items-center space-x-2">
                <span
                  class="material-symbols-outlined text-lg"
                  :class="step.status === 'active' ? 'text-primary' : 'text-text-muted'"
                  >{{ stepIcon(step) }}</span
                >
                <span class="min-w-0 flex-1 truncate">{{ step.label }}</span>
                <span
                  v-if="step.status === 'active' && step.type === 'thinking'"
                  class="flex h-[18px] items-center space-x-1"
                >
                  <span
                    v-for="dot in 3"
                    :key="dot"
                    class="agent-thinking-dot h-1.5 w-1.5 rounded-full bg-text-muted"
                    :style="{ animationDelay: `${(dot - 1) * 140}ms` }"
                  />
                </span>
              </div>

              <div
                v-if="step.text"
                class="mt-1.5 whitespace-pre-wrap break-words text-text-main"
                v-text="step.text"
              ></div>

              <pre
                v-if="stepInput(step)"
                class="mt-1.5 max-h-40 overflow-auto rounded-sm border border-surface-border bg-surface px-2 py-1.5 text-xs leading-5 text-text-main"
                >{{ stepInput(step) }}</pre
              >
              <pre
                v-if="stepOutput(step)"
                class="mt-1.5 max-h-48 overflow-auto rounded-sm border border-surface-border bg-surface px-2 py-1.5 text-xs leading-5 text-text-main"
                >{{ stepOutput(step) }}</pre
              >

              <div
                v-if="step.status === 'active' && step.type === 'progress'"
                class="mt-1.5 flex h-[18px] items-center space-x-1"
              >
                <span
                  v-for="dot in 3"
                  :key="dot"
                  class="agent-thinking-dot h-1.5 w-1.5 rounded-full bg-text-muted"
                  :style="{ animationDelay: `${(dot - 1) * 140}ms` }"
                />
              </div>
            </div>
          </div>
        </Transition>

        <div v-if="hasText" class="font-medium text-text-main">{{ message.text }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.agent-thinking-dot {
  animation: agent-thinking-bounce 840ms ease-in-out infinite;
}

.run-panel-enter-active,
.run-panel-leave-active {
  max-height: 70vh;
  opacity: 1;
  transform: translateY(0);
  transition:
    max-height 240ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 180ms ease,
    transform 240ms cubic-bezier(0.16, 1, 0.3, 1),
    margin-bottom 240ms cubic-bezier(0.16, 1, 0.3, 1);
}

.run-panel-enter-from,
.run-panel-leave-to {
  max-height: 0;
  opacity: 0;
  transform: translateY(-6px);
  margin-bottom: 0;
}

@keyframes agent-thinking-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.45;
  }

  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .agent-thinking-dot {
    animation: none;
  }

  .run-panel-enter-active,
  .run-panel-leave-active {
    transition: none;
  }
}
</style>
