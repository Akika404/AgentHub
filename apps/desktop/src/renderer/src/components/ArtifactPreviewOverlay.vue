<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BlackboardArtifact, BlackboardArtifactPreview } from '../api'
import { ApiError } from '../api'
import { groupChatApi } from '../api/group-chats'
import ArtifactPreviewBody from './ArtifactPreviewBody.vue'

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
            <span class="material-symbols-outlined text-2xl text-primary">preview</span>
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

          <ArtifactPreviewBody :preview="preview" :loading="loading" :error-text="errorText" />
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
