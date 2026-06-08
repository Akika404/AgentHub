<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  ServerDirectoryEntry,
  ServerDirectoryListing,
  ServerDirectoryRoot
} from '@agenthub/shared'
import { ApiError, workspaceFsApi } from '../api'
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseSelect from './ui/BaseSelect.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    mode?: 'single' | 'multiple'
    initialPath?: string
    initialPaths?: string[]
  }>(),
  {
    title: '选择服务器目录',
    mode: 'single',
    initialPath: '',
    initialPaths: () => []
  }
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', paths: string[]): void
}>()

const roots = ref<ServerDirectoryRoot[]>([])
const listing = ref<ServerDirectoryListing | null>(null)
const rootPath = ref('')
const pathDraft = ref('')
const selectedPaths = ref<string[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const isMultiple = computed(() => props.mode === 'multiple')
const currentPath = computed(() => listing.value?.path ?? pathDraft.value.trim())
const selectedSet = computed(() => new Set(selectedPaths.value))

function unique(paths: string[]): string[] {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
}

function messageForError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function applyListing(next: ServerDirectoryListing): void {
  listing.value = next
  pathDraft.value = next.path
  rootPath.value = next.root.path
}

async function initialize(): Promise<void> {
  loading.value = true
  error.value = null
  listing.value = null
  selectedPaths.value = unique(isMultiple.value ? props.initialPaths : [])

  try {
    roots.value = await workspaceFsApi.roots()
    if (roots.value.length === 0) {
      error.value = '服务器没有可浏览的工作区根目录'
      return
    }

    const initial =
      props.initialPath.trim() ||
      selectedPaths.value[0] ||
      roots.value.find((root) => props.initialPaths.some((path) => path.startsWith(root.path)))
        ?.path ||
      roots.value[0].path
    applyListing(await workspaceFsApi.directories(initial))
  } catch (err) {
    error.value = messageForError(err, '加载服务器目录失败')
  } finally {
    loading.value = false
  }
}

async function loadDirectory(path?: string): Promise<void> {
  loading.value = true
  error.value = null
  try {
    applyListing(await workspaceFsApi.directories(path))
  } catch (err) {
    error.value = messageForError(err, '读取服务器目录失败')
  } finally {
    loading.value = false
  }
}

function close(): void {
  emit('close')
}

function openParent(): void {
  if (!listing.value?.parentPath) return
  void loadDirectory(listing.value.parentPath)
}

function refresh(): void {
  const path = pathDraft.value.trim() || listing.value?.path
  void loadDirectory(path)
}

function openEntry(entry: ServerDirectoryEntry): void {
  if (!entry.readable) return
  void loadDirectory(entry.path)
}

function addPath(path: string): void {
  selectedPaths.value = unique([...selectedPaths.value, path])
}

function removePath(path: string): void {
  selectedPaths.value = selectedPaths.value.filter((item) => item !== path)
}

function toggleSelected(entry: ServerDirectoryEntry): void {
  if (!entry.readable) return
  if (selectedSet.value.has(entry.path)) removePath(entry.path)
  else addPath(entry.path)
}

function addCurrent(): void {
  if (!currentPath.value) return
  addPath(currentPath.value)
}

function confirm(): void {
  const draft = pathDraft.value.trim()
  const paths = isMultiple.value ? selectedPaths.value : unique([draft || currentPath.value])
  const confirmed = paths.length > 0 ? paths : unique([draft || currentPath.value])
  if (confirmed.length === 0) return
  emit('confirm', confirmed)
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) void initialize()
  }
)

watch(rootPath, (next) => {
  if (!props.open || !next || listing.value?.root.path === next) return
  void loadDirectory(next)
})
</script>

<template>
  <Modal :open="open" :title="title" :width="760" @close="close">
    <div class="space-y-4">
      <div class="grid grid-cols-[minmax(0,180px)_1fr_auto] gap-2">
        <BaseSelect v-model="rootPath" :disabled="loading || roots.length === 0">
          <option v-for="root in roots" :key="root.id" :value="root.path">
            {{ root.label }}
          </option>
        </BaseSelect>
        <BaseInput
          v-model="pathDraft"
          mono
          type="text"
          placeholder="/server/path"
          @keyup.enter="refresh"
        />
        <BaseButton variant="secondary" size="lg" :disabled="loading" @click="refresh">
          <span class="material-symbols-outlined text-xl">subdirectory_arrow_right</span>
          转到
        </BaseButton>
      </div>

      <div class="flex items-center justify-between gap-2">
        <div class="min-w-0 flex items-center gap-2 text-sm text-text-muted">
          <span class="material-symbols-outlined text-xl">dns</span>
          <span class="truncate font-mono">{{ currentPath || '服务器目录' }}</span>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <BaseButton
            variant="secondary"
            size="sm"
            :disabled="loading || !listing?.parentPath"
            @click="openParent"
          >
            <span class="material-symbols-outlined text-xl">arrow_upward</span>
            上一级
          </BaseButton>
          <BaseButton variant="secondary" size="sm" :disabled="loading" @click="refresh">
            <span class="material-symbols-outlined text-xl">refresh</span>
            刷新
          </BaseButton>
          <BaseButton v-if="isMultiple" variant="secondary" size="sm" @click="addCurrent">
            <span class="material-symbols-outlined text-xl">add</span>
            加入当前
          </BaseButton>
        </div>
      </div>

      <div
        class="min-h-[280px] max-h-[360px] overflow-y-auto rounded-md border border-surface-border bg-surface"
      >
        <div
          v-if="loading"
          class="flex h-[280px] items-center justify-center text-sm text-text-muted"
        >
          正在读取服务器目录...
        </div>
        <div
          v-else-if="error"
          class="flex h-[280px] items-center justify-center px-6 text-center text-sm text-danger"
        >
          {{ error }}
        </div>
        <div
          v-else-if="!listing || listing.entries.length === 0"
          class="flex h-[280px] items-center justify-center text-sm text-text-muted"
        >
          当前目录下没有子目录
        </div>
        <div v-else class="divide-y divide-surface-border">
          <div
            v-for="entry in listing.entries"
            :key="entry.path"
            class="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors"
            :class="entry.readable ? 'hover:bg-surface-hover' : 'cursor-not-allowed opacity-55'"
          >
            <button
              v-if="isMultiple"
              type="button"
              class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded hover:bg-surface-hover disabled:pointer-events-none"
              :disabled="!entry.readable"
              @click="toggleSelected(entry)"
            >
              <span
                class="material-symbols-outlined text-xl"
                :class="selectedSet.has(entry.path) ? 'text-primary' : 'text-text-muted'"
              >
                {{ selectedSet.has(entry.path) ? 'check_box' : 'check_box_outline_blank' }}
              </span>
            </button>
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
              :disabled="!entry.readable"
              @click="openEntry(entry)"
            >
              <span class="material-symbols-outlined text-xl text-amber-600">folder</span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base font-medium text-text-main">
                  {{ entry.name }}
                </span>
                <span class="block truncate font-mono text-xs text-text-muted">
                  {{ entry.path }}
                </span>
              </span>
            </button>
            <button
              v-if="isMultiple"
              type="button"
              class="inline-flex h-8 shrink-0 items-center justify-center rounded px-2 text-sm text-text-main hover:bg-surface-hover disabled:pointer-events-none"
              :disabled="!entry.readable"
              @click="openEntry(entry)"
            >
              打开
            </button>
            <span v-else class="material-symbols-outlined text-xl text-text-muted">
              chevron_right
            </span>
          </div>
        </div>
      </div>

      <div
        v-if="isMultiple"
        class="rounded-md border border-surface-border bg-surface-hover/60 p-3"
      >
        <div class="mb-2 text-sm font-medium text-text-main">已选择目录</div>
        <div v-if="selectedPaths.length === 0" class="text-sm text-text-muted">
          选择子目录或加入当前目录。
        </div>
        <div v-else class="flex flex-wrap gap-2">
          <button
            v-for="path in selectedPaths"
            :key="path"
            type="button"
            class="inline-flex max-w-full items-center gap-1 rounded-md border border-surface-border bg-surface px-2 py-1 text-left font-mono text-xs text-text-main hover:bg-surface-hover"
            @click="removePath(path)"
          >
            <span class="truncate">{{ path }}</span>
            <span class="material-symbols-outlined text-base text-text-muted">close</span>
          </button>
        </div>
      </div>

      <p class="text-xs text-text-muted">
        这里显示的是后端服务器上的目录；新目录可以直接输入路径，保存时由后端创建。
      </p>
    </div>

    <template #footer>
      <BaseButton variant="ghost" @click="close">取消</BaseButton>
      <BaseButton :disabled="loading || (!isMultiple && !pathDraft.trim())" @click="confirm">
        {{ isMultiple ? '使用所选目录' : '使用当前目录' }}
      </BaseButton>
    </template>
  </Modal>
</template>
