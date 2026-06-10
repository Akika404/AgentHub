<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BlackboardArtifact, BlackboardArtifactPreview } from '../api'
import { ApiError } from '../api'
import { groupChatApi } from '../api/group-chats'

const props = defineProps<{
  groupId: string | null
  artifact: BlackboardArtifact | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const loading = ref(false)
const preview = ref<BlackboardArtifactPreview | null>(null)
const editorText = ref('')
const errorText = ref<string | null>(null)
let loadSeq = 0

const open = computed(() => Boolean(props.groupId && props.artifact))
const title = computed(() => props.artifact?.path ?? '编辑文件')
const editable = computed(
  () => preview.value?.previewKind === 'text' || preview.value?.previewKind === 'html'
)

const kindLabel = computed(() => {
  switch (preview.value?.previewKind) {
    case 'text':
      return '文本'
    case 'html':
      return 'HTML'
    case 'pdf':
      return 'PDF'
    case 'image':
      return '图片'
    case 'audio':
      return '音频'
    case 'video':
      return '视频'
    case 'office':
      return 'Office'
    case 'too_large':
      return '过大'
    case 'binary':
      return '二进制'
    default:
      return '预览'
  }
})

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

async function loadPreview(): Promise<void> {
  const groupId = props.groupId
  const artifact = props.artifact
  const seq = ++loadSeq

  preview.value = null
  errorText.value = null
  if (!groupId || !artifact) return

  loading.value = true
  try {
    const next = await groupChatApi.getArtifactPreview(groupId, artifact.id)
    if (seq === loadSeq) preview.value = next
  } catch (err) {
    if (seq !== loadSeq) return
    errorText.value = err instanceof ApiError ? err.message : '加载预览失败'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(
  () => [props.groupId, props.artifact?.id] as const,
  () => void loadPreview(),
  { immediate: true }
)

watch(
  () => preview.value?.content,
  (content) => {
    editorText.value = content ?? ''
  },
  { immediate: true }
)
</script>

<template>
  <Teleport to="body">
    <Transition name="overlay-fade">
      <div
        v-if="open"
        class="fixed inset-0 z-40 flex flex-col bg-black/60 backdrop-blur-sm"
        @click.self="emit('close')"
      >
        <div class="m-6 flex flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
          <header
            class="flex h-14 flex-shrink-0 items-center gap-3 border-b border-surface-border px-5"
          >
            <span class="material-symbols-outlined text-2xl text-primary">edit</span>
            <div class="min-w-0 flex-1">
              <h3 class="truncate text-md font-semibold text-text-main">{{ title }}</h3>
              <p class="truncate text-xs text-text-muted">
                {{ preview ? `${kindLabel} · ${formatBytes(preview.size)}` : '准备打开文件' }}
              </p>
            </div>
            <button
              type="button"
              class="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-main"
              title="关闭编辑窗口"
              @click="emit('close')"
            >
              <span class="material-symbols-outlined text-2xl">close</span>
            </button>
          </header>

          <div class="min-h-0 flex-1 bg-surface-hover">
            <div v-if="loading" class="flex h-full items-center justify-center text-sm text-text-muted">
              加载中…
            </div>
            <div v-else-if="errorText" class="flex h-full items-center justify-center px-8 text-center">
              <div class="rounded-md border border-danger/20 bg-white px-4 py-3 text-sm text-danger">
                {{ errorText }}
              </div>
            </div>
            <template v-else-if="preview">
              <textarea
                v-if="editable"
                v-model="editorText"
                class="h-full w-full resize-none border-0 bg-[#101418] p-5 font-mono text-sm leading-6 text-[#e8edf2] outline-none selection:bg-primary/40"
                spellcheck="false"
              ></textarea>

              <div v-else class="flex h-full items-center justify-center px-8 text-center">
                <div class="max-w-[360px] rounded-md border border-surface-border bg-white p-5">
                  <span class="material-symbols-outlined text-4xl text-text-muted">draft</span>
                  <h4 class="mt-3 text-md font-semibold text-text-main">{{ preview.fileName }}</h4>
                  <p class="mt-1 text-sm text-text-muted">
                    {{ preview.message || '该文件类型暂不支持在编辑窗口打开。' }}
                  </p>
                  <div class="mt-4 space-y-1 text-left font-mono text-xs text-text-muted">
                    <div>type: {{ preview.mimeType }}</div>
                    <div>size: {{ formatBytes(preview.size) }}</div>
                    <div>path: {{ preview.artifact.path }}</div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay-fade-enter-active,
.overlay-fade-leave-active {
  transition: opacity 0.18s ease;
}
.overlay-fade-enter-from,
.overlay-fade-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .overlay-fade-enter-active,
  .overlay-fade-leave-active {
    transition: none;
  }
}
</style>
