<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { DeploymentEvent, DeploymentLogStream, DeploymentView } from '../api'
import { ApiError } from '../api'
import { groupChatApi, type SseSubscription } from '../api/group-chats'

const props = defineProps<{
  groupId: string | null
  /** the deployment to show; null closes the drawer. */
  deployment: DeploymentView | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

type Tab = 'preview' | 'logs'

interface LogLine {
  stream: DeploymentLogStream
  line: string
}

const tab = ref<Tab>('preview')
const current = ref<DeploymentView | null>(null)
const logs = ref<LogLine[]>([])
const errorText = ref<string | null>(null)
const stopping = ref(false)
const logScroll = ref<HTMLElement | null>(null)
let subscription: SseSubscription | null = null

const open = computed(() => Boolean(props.groupId && props.deployment))
const status = computed(() => current.value?.status ?? props.deployment?.status ?? 'starting')
const url = computed(() => current.value?.url ?? null)
const isRunning = computed(() => status.value === 'running' && Boolean(url.value))

const statusLabel = computed(() => {
  switch (status.value) {
    case 'installing':
      return '安装依赖中'
    case 'starting':
      return '启动中'
    case 'running':
      return '运行中'
    case 'stopped':
      return '已停止'
    case 'failed':
      return '启动失败'
    default:
      return status.value
  }
})

const statusTone = computed(() => {
  switch (status.value) {
    case 'running':
      return 'bg-success-soft text-success'
    case 'failed':
      return 'bg-danger-soft text-danger'
    case 'stopped':
      return 'bg-surface-hover text-text-muted'
    default:
      return 'bg-warning-soft text-warning'
  }
})

function resetState(): void {
  current.value = props.deployment
  logs.value = []
  errorText.value = null
  stopping.value = false
  tab.value = 'preview'
}

async function teardownSubscription(): Promise<void> {
  if (!subscription) return
  const sub = subscription
  subscription = null
  await sub.cancel().catch(() => undefined)
}

function applyEvent(event: DeploymentEvent): void {
  if (event.type === 'log') {
    logs.value.push({ stream: event.stream, line: event.line })
    if (logs.value.length > 2000) logs.value.splice(0, logs.value.length - 2000)
    queueLogScroll()
    return
  }
  // status event
  if (!current.value) return
  current.value = {
    ...current.value,
    status: event.status,
    port: event.port,
    url: event.url,
    error: event.error
  }
  if (event.status === 'running') tab.value = 'preview'
  if (event.status === 'failed' && event.error) errorText.value = event.error
}

function queueLogScroll(): void {
  requestAnimationFrame(() => {
    const el = logScroll.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

async function startSubscription(): Promise<void> {
  await teardownSubscription()
  const groupId = props.groupId
  const deployment = props.deployment
  if (!groupId || !deployment) return
  subscription = groupChatApi.subscribeDeployment(groupId, deployment.id, {
    onEvent: applyEvent,
    onError: (message) => {
      errorText.value = message
    }
  })
  try {
    await subscription.started
  } catch (err) {
    errorText.value = err instanceof ApiError ? err.message : '无法连接到部署日志'
  }
}

async function stopDeployment(): Promise<void> {
  const groupId = props.groupId
  const deployment = props.deployment
  if (!groupId || !deployment || stopping.value) return
  stopping.value = true
  try {
    await groupChatApi.stopDeployment(groupId, deployment.id)
  } catch (err) {
    errorText.value = err instanceof ApiError ? err.message : '停止失败'
  } finally {
    stopping.value = false
  }
}

async function close(): Promise<void> {
  await teardownSubscription()
  emit('close')
}

watch(
  () => [props.groupId, props.deployment?.id] as const,
  () => {
    resetState()
    void startSubscription()
  },
  { immediate: true }
)

onUnmounted(() => void teardownSubscription())
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-slide">
      <aside
        v-if="open"
        class="fixed inset-y-0 right-0 z-30 flex w-[520px] max-w-[calc(100vw-72px)] flex-col border-l border-surface-border bg-white shadow-[-12px_0_32px_rgba(31,35,41,0.12)]"
      >
        <header
          class="flex h-14 flex-shrink-0 items-center gap-3 border-b border-surface-border px-4"
        >
          <span class="material-symbols-outlined text-2xl text-primary">rocket_launch</span>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-md font-semibold text-text-main">运行预览</h3>
            <p class="truncate text-xs text-text-muted">
              {{ url ?? (current?.port ? `localhost:${current.port}` : '准备运行') }}
            </p>
          </div>
          <span class="rounded px-2 py-0.5 text-xs font-medium" :class="statusTone">
            {{ statusLabel }}
          </span>
          <button
            type="button"
            class="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-main disabled:opacity-50"
            title="停止运行"
            :disabled="status === 'stopped' || status === 'failed' || stopping"
            @click="stopDeployment"
          >
            <span class="material-symbols-outlined text-2xl">stop_circle</span>
          </button>
          <button
            type="button"
            class="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-main"
            title="关闭"
            @click="close"
          >
            <span class="material-symbols-outlined text-2xl">close</span>
          </button>
        </header>

        <div class="flex flex-shrink-0 border-b border-surface-border px-2">
          <button
            type="button"
            class="px-3 py-2 text-sm font-medium transition-colors"
            :class="
              tab === 'preview'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            "
            @click="tab = 'preview'"
          >
            预览
          </button>
          <button
            type="button"
            class="px-3 py-2 text-sm font-medium transition-colors"
            :class="
              tab === 'logs'
                ? 'border-b-2 border-primary text-primary'
                : 'text-text-muted hover:text-text-main'
            "
            @click="tab = 'logs'"
          >
            日志
          </button>
        </div>

        <div class="min-h-0 flex-1 bg-surface-hover">
          <!-- 预览 tab -->
          <template v-if="tab === 'preview'">
            <iframe
              v-if="isRunning && url"
              class="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"
              :src="url"
            ></iframe>
            <div v-else class="flex h-full items-center justify-center px-8 text-center">
              <div class="max-w-[320px] rounded-md border border-surface-border bg-white p-5">
                <span
                  v-if="status === 'failed'"
                  class="material-symbols-outlined text-4xl text-danger"
                  >error</span
                >
                <span
                  v-else
                  class="material-symbols-outlined text-4xl text-text-muted animate-pulse"
                  >hourglass_top</span
                >
                <h4 class="mt-3 text-md font-semibold text-text-main">{{ statusLabel }}</h4>
                <p class="mt-1 text-sm text-text-muted">
                  {{
                    status === 'failed'
                      ? (errorText ?? '启动失败，请查看日志')
                      : status === 'stopped'
                        ? '部署已停止'
                        : '正在准备 dev server，就绪后自动显示页面…'
                  }}
                </p>
                <button
                  v-if="status === 'failed' || status === 'stopped'"
                  type="button"
                  class="mt-3 text-sm text-primary hover:underline"
                  @click="tab = 'logs'"
                >
                  查看日志
                </button>
              </div>
            </div>
          </template>

          <!-- 日志 tab -->
          <div
            v-else
            ref="logScroll"
            class="h-full overflow-auto bg-[#101418] p-4 font-mono text-xs leading-5"
          >
            <div v-if="logs.length === 0" class="text-[#7a8694]">暂无日志输出…</div>
            <div
              v-for="(log, i) in logs"
              :key="i"
              :class="
                log.stream === 'stderr'
                  ? 'text-[#ff9a9a]'
                  : log.stream === 'system'
                    ? 'text-[#7ab8ff]'
                    : 'text-[#e8edf2]'
              "
            >
              {{ log.line }}
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>
