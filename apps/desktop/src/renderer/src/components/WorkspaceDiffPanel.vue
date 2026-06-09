<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkspaceDiffFile, WorkspaceDiffSummary } from '../api'

const props = defineProps<{
  diff?: WorkspaceDiffSummary | null
  loading?: boolean
  error?: string | null
  committing?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'commit'): void
}>()

const expanded = ref<Set<string>>(new Set())

const files = computed(() => props.diff?.files ?? [])
const visible = computed(() => props.loading || props.error || files.value.length > 0)
const commitDisabled = computed(
  () => props.disabled || props.loading || props.committing || files.value.length === 0
)

watch(
  files,
  (next) => {
    const paths = new Set(next.map((file) => file.path))
    const kept = new Set([...expanded.value].filter((path) => paths.has(path)))
    expanded.value = kept
  },
  { deep: false }
)

function toggle(file: WorkspaceDiffFile): void {
  if (!file.expandable) return
  const next = new Set(expanded.value)
  if (next.has(file.path)) next.delete(file.path)
  else next.add(file.path)
  expanded.value = next
}

function isExpanded(file: WorkspaceDiffFile): boolean {
  return expanded.value.has(file.path)
}

function statusLabel(file: WorkspaceDiffFile): string {
  switch (file.status) {
    case 'added':
    case 'untracked':
      return '新增'
    case 'deleted':
      return '删除'
    case 'renamed':
      return '重命名'
    case 'modified':
      return '修改'
    default:
      return '变更'
  }
}

function rowClass(file: WorkspaceDiffFile): string {
  switch (file.status) {
    case 'added':
    case 'untracked':
      return 'border-success-border bg-success-soft'
    case 'deleted':
      return 'border-danger-border bg-danger-soft'
    default:
      return 'border-primary/50 bg-primary-soft'
  }
}

function statusClass(file: WorkspaceDiffFile): string {
  switch (file.status) {
    case 'added':
    case 'untracked':
      return 'text-success'
    case 'deleted':
      return 'text-danger'
    default:
      return 'text-primary'
  }
}

function diffLines(diff: string | null): string[] {
  return diff ? diff.replace(/\n$/, '').split(/\r?\n/) : []
}

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'bg-primary-soft text-primary'
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-text-muted'
  if (line.startsWith('+')) return 'bg-success-soft text-success'
  if (line.startsWith('-')) return 'bg-danger-soft text-danger'
  return 'text-text-main'
}
</script>

<template>
  <div v-if="visible" class="mb-2 rounded-md border border-surface-border bg-background p-2">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <span class="material-symbols-outlined text-xl text-text-muted">difference</span>
        <span class="truncate text-sm font-semibold text-text-main">工作区变更</span>
        <span
          v-if="files.length > 0"
          class="rounded-sm bg-white px-1.5 py-0.5 text-xs font-medium text-text-muted"
        >
          {{ files.length }} 文件
        </span>
      </div>
      <div class="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-sm text-text-muted transition-colors hover:bg-white hover:text-text-main disabled:opacity-50"
          title="刷新变更"
          :disabled="loading || committing"
          @click="emit('refresh')"
        >
          <span class="material-symbols-outlined text-xl">refresh</span>
        </button>
        <button
          type="button"
          class="flex h-7 items-center gap-1 rounded-sm border border-surface-border bg-white px-2 text-sm font-medium text-text-main transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="commitDisabled"
          @click="emit('commit')"
        >
          <span class="material-symbols-outlined text-lg">commit</span>
          <span>{{ committing ? '提交中' : '提交' }}</span>
        </button>
      </div>
    </div>

    <p
      v-if="error"
      class="mb-2 rounded-sm border border-danger-border bg-white px-2 py-1.5 text-sm text-danger"
    >
      {{ error }}
    </p>
    <div v-if="loading && files.length === 0" class="px-2 py-2 text-sm text-text-muted">
      正在读取工作区变更...
    </div>

    <div v-if="files.length > 0" class="max-h-64 space-y-1 overflow-y-auto pr-1">
      <div
        v-for="file in files"
        :key="file.path"
        class="overflow-hidden rounded-sm border bg-white"
        :class="rowClass(file)"
      >
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-left"
          :class="file.expandable ? 'hover:bg-white/70' : 'cursor-default'"
          @click="toggle(file)"
        >
          <span
            class="material-symbols-outlined flex h-5 w-5 flex-shrink-0 items-center justify-center text-lg text-text-muted"
          >
            {{ file.expandable ? (isExpanded(file) ? 'expand_more' : 'chevron_right') : 'remove' }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-mono text-xs text-text-main">{{ file.path }}</span>
            <span v-if="file.oldPath" class="block truncate font-mono text-[11px] text-text-muted">
              from {{ file.oldPath }}
            </span>
          </span>
          <span class="flex flex-shrink-0 items-center gap-1.5 text-xs font-semibold">
            <span :class="statusClass(file)">{{ statusLabel(file) }}</span>
            <span v-if="file.additions > 0" class="text-success">+{{ file.additions }}</span>
            <span v-if="file.deletions > 0" class="text-danger">-{{ file.deletions }}</span>
            <span v-if="file.tooLarge" class="font-medium text-text-muted">过长</span>
          </span>
        </button>
        <pre
          v-if="file.expandable && isExpanded(file)"
          class="max-h-56 overflow-auto border-t border-surface-border bg-white py-1 font-mono text-[11px] leading-5"
        ><code><span
            v-for="(line, index) in diffLines(file.diff)"
            :key="`${file.path}-${index}`"
            class="block min-w-max px-2"
            :class="lineClass(line)"
          >{{ line || ' ' }}</span></code></pre>
      </div>
    </div>
  </div>
</template>
