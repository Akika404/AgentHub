<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
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
const errorText = ref<string | null>(null)
const htmlPreviewUrl = ref<string | null>(null)
let loadSeq = 0

const open = computed(() => Boolean(props.groupId && props.artifact))
const title = computed(() => props.artifact?.path ?? '产出物预览')

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

function clearHtmlPreviewUrl(): void {
  if (!htmlPreviewUrl.value) return
  void window.api.releasePreviewHtml(htmlPreviewUrl.value)
  htmlPreviewUrl.value = null
}

async function setPreview(next: BlackboardArtifactPreview | null): Promise<void> {
  clearHtmlPreviewUrl()
  preview.value = next
  if (next?.previewKind !== 'html') return
  // Serve HTML over a custom scheme rather than a blob: URL — blob documents
  // inherit the renderer's strict CSP (`script-src 'self'`), which silently
  // blocks the inlined scripts and leaves only static markup rendered.
  htmlPreviewUrl.value = await window.api.registerPreviewHtml(next.content ?? '')
}

async function loadPreview(): Promise<void> {
  const groupId = props.groupId
  const artifact = props.artifact
  const seq = ++loadSeq

  await setPreview(null)
  errorText.value = null
  if (!groupId || !artifact) return

  loading.value = true
  try {
    const next = await groupChatApi.getArtifactPreview(groupId, artifact.id)
    if (seq === loadSeq) await setPreview(next)
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

onUnmounted(clearHtmlPreviewUrl)
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-slide">
      <aside
        v-if="open"
        class="fixed inset-y-0 right-0 z-30 flex w-[460px] max-w-[calc(100vw-72px)] flex-col border-l border-surface-border bg-white shadow-[-12px_0_32px_rgba(31,35,41,0.12)]"
      >
        <header
          class="flex h-14 flex-shrink-0 items-center gap-3 border-b border-surface-border px-4"
        >
          <span class="material-symbols-outlined text-2xl text-primary">draft</span>
          <div class="min-w-0 flex-1">
            <h3 class="truncate text-md font-semibold text-text-main">{{ title }}</h3>
            <p class="truncate text-xs text-text-muted">
              {{ preview ? `${kindLabel} · ${formatBytes(preview.size)}` : '准备预览' }}
            </p>
          </div>
          <button
            type="button"
            class="rounded p-1.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-main"
            title="关闭预览"
            @click="emit('close')"
          >
            <span class="material-symbols-outlined text-2xl">close</span>
          </button>
        </header>

        <div class="min-h-0 flex-1 bg-surface-hover">
          <div
            v-if="loading"
            class="flex h-full items-center justify-center text-sm text-text-muted"
          >
            加载中…
          </div>
          <div
            v-else-if="errorText"
            class="flex h-full items-center justify-center px-8 text-center"
          >
            <div class="rounded-md border border-danger/20 bg-white px-4 py-3 text-sm text-danger">
              {{ errorText }}
            </div>
          </div>
          <template v-else-if="preview">
            <pre
              v-if="preview.previewKind === 'text'"
              class="h-full overflow-auto bg-[#101418] p-4 font-mono text-sm leading-6 text-[#e8edf2]"
            >{{ preview.content }}</pre>

            <iframe
              v-else-if="preview.previewKind === 'html'"
              class="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"
              :src="htmlPreviewUrl ?? 'about:blank'"
            ></iframe>

            <iframe
              v-else-if="preview.previewKind === 'pdf' && preview.dataUrl"
              class="h-full w-full border-0 bg-white"
              :src="preview.dataUrl"
            ></iframe>

            <div
              v-else-if="preview.previewKind === 'image' && preview.dataUrl"
              class="flex h-full items-center justify-center p-4"
            >
              <img
                :src="preview.dataUrl"
                :alt="preview.fileName"
                class="max-h-full max-w-full rounded-md border border-surface-border bg-white object-contain"
              />
            </div>

            <div
              v-else-if="preview.previewKind === 'audio' && preview.dataUrl"
              class="flex h-full items-center justify-center p-6"
            >
              <audio class="w-full" controls :src="preview.dataUrl"></audio>
            </div>

            <div
              v-else-if="preview.previewKind === 'video' && preview.dataUrl"
              class="flex h-full items-center justify-center bg-black p-4"
            >
              <video class="max-h-full max-w-full" controls :src="preview.dataUrl"></video>
            </div>

            <div v-else class="flex h-full items-center justify-center px-8 text-center">
              <div class="max-w-[320px] rounded-md border border-surface-border bg-white p-5">
                <span class="material-symbols-outlined text-4xl text-text-muted">draft</span>
                <h4 class="mt-3 text-md font-semibold text-text-main">{{ preview.fileName }}</h4>
                <p class="mt-1 text-sm text-text-muted">
                  {{ preview.message || '该文件类型暂不支持在应用内预览。' }}
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
      </aside>
    </Transition>
  </Teleport>
</template>
