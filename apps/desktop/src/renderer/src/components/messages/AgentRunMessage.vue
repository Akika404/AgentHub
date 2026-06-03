<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentRunMessage, AgentRunStep } from '../../types/chatDisplay'
import { formatTime } from '../../utils/format'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: AgentRunMessage }>()

const expanded = ref(false)

const hasText = computed(() => props.message.text.trim().length > 0)
const activeStep = computed(() => props.message.steps.find((step) => step.status === 'active'))
const completedCount = computed(
  () => props.message.steps.filter((step) => step.status !== 'active').length
)
const terminalLabel = computed(() =>
  props.message.status === 'error' ? '运行失败' : '运行完成，未返回文本'
)
const terminalIcon = computed(() => (props.message.status === 'error' ? 'error' : 'check'))

function stepIcon(step: AgentRunStep): string {
  if (step.status === 'failed') return 'error'
  if (step.status === 'completed') return 'check'
  return step.type === 'tool' ? 'build' : 'more_horiz'
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
        class="bg-surface-hover p-3 rounded-md rounded-tl-sm text-md leading-[22px] whitespace-pre-wrap break-words"
      >
        <button
          v-if="hasText && message.steps.length"
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

        <div v-if="!hasText" class="flex h-[22px] items-center">
          <div v-if="activeStep?.type === 'tool'" class="whitespace-nowrap">
            {{ activeStep.label }}
          </div>
          <div v-else-if="activeStep?.type === 'thinking'" class="flex items-center space-x-1">
            <span
              v-for="dot in 3"
              :key="dot"
              class="agent-thinking-dot h-1.5 w-1.5 rounded-full bg-text-muted"
              :style="{ animationDelay: `${(dot - 1) * 140}ms` }"
            />
          </div>
          <div v-else class="flex min-w-0 items-center space-x-1.5 text-text-muted">
            <span class="material-symbols-outlined text-lg">{{ terminalIcon }}</span>
            <span class="truncate">{{ terminalLabel }}</span>
          </div>
        </div>

        <Transition name="run-panel">
          <div v-if="hasText && expanded" class="mb-3 space-y-1.5 overflow-hidden">
            <div
              v-for="step in message.steps"
              :key="step.id"
              class="flex items-center space-x-2 rounded-sm px-2 py-1.5 text-sm"
              :class="[
                step.status === 'active' ? 'bg-white/70 text-text-main' : 'text-text-muted',
                step.status === 'failed' ? 'text-danger-strong' : ''
              ]"
            >
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
          </div>
        </Transition>

        <div v-if="hasText">{{ message.text }}</div>
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
  max-height: 260px;
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
