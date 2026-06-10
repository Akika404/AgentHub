<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BlackboardArtifact, BlackboardArtifactPreview } from '../api'
import { ApiError } from '../api'
import { groupChatApi } from '../api/group-chats'
import { agentChatApi } from '../api/agents'

const props = defineProps<{
  /** 群聊来源:据 artifact.id 取黑板产物预览 */
  groupId?: string | null
  /** 单聊来源:据 artifact.path(工作目录相对路径)取工作区文件预览 */
  chatId?: string | null
  artifact: BlackboardArtifact | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const loading = ref(false)
const saving = ref(false)
const preview = ref<BlackboardArtifactPreview | null>(null)
const editorText = ref('')
const errorText = ref<string | null>(null)
const saveError = ref<string | null>(null)
const saveMessage = ref<string | null>(null)
let loadSeq = 0

const open = computed(() => Boolean((props.groupId || props.chatId) && props.artifact))
const title = computed(() => props.artifact?.path ?? '编辑文件')
const editable = computed(() => {
  const current = preview.value
  return Boolean(
    current &&
      (current.previewKind === 'text' || current.previewKind === 'html') &&
      current.editableContent !== null
  )
})
const dirty = computed(
  () => editable.value && editorText.value !== (preview.value?.editableContent ?? '')
)
const canSave = computed(() => editable.value && dirty.value && !saving.value && !loading.value)
const saveStatusText = computed(() => {
  if (saveError.value) return saveError.value
  if (saving.value) return '保存中…'
  if (dirty.value) return '未保存'
  return saveMessage.value
})

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
  const chatId = props.chatId
  const artifact = props.artifact
  const seq = ++loadSeq

  preview.value = null
  errorText.value = null
  saveError.value = null
  saveMessage.value = null
  if (!artifact || (!groupId && !chatId)) return

  loading.value = true
  try {
    // 群聊据黑板 artifact.id 取数;单聊据 artifact.path(工作目录相对路径)取数。
    const next = groupId
      ? await groupChatApi.getArtifactPreview(groupId, artifact.id)
      : await agentChatApi.getArtifactPreview(chatId as string, artifact.path)
    if (seq === loadSeq) preview.value = next
  } catch (err) {
    if (seq !== loadSeq) return
    errorText.value = err instanceof ApiError ? err.message : '加载预览失败'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

async function saveContent(): Promise<void> {
  const groupId = props.groupId
  const chatId = props.chatId
  const artifact = props.artifact
  const currentPreview = preview.value
  if (!artifact || !currentPreview || !editable.value || !dirty.value || (!groupId && !chatId)) {
    return
  }

  saving.value = true
  saveError.value = null
  saveMessage.value = null
  try {
    const payload = {
      content: editorText.value,
      baseVersion: currentPreview.artifact.version
    }
    const next = groupId
      ? await groupChatApi.saveArtifactContent(groupId, artifact.id, payload)
      : await agentChatApi.saveArtifactContent(chatId as string, artifact.path, payload)
    preview.value = next
    saveMessage.value = '已保存'
  } catch (err) {
    saveError.value = err instanceof ApiError ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

watch(
  () => [props.groupId, props.chatId, props.artifact?.id] as const,
  () => void loadPreview(),
  { immediate: true }
)

watch(
  () => preview.value,
  (next) => {
    editorText.value = next?.editableContent ?? ''
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
            <span
              v-if="editable && saveStatusText"
              class="hidden max-w-[220px] truncate text-xs sm:block"
              :class="saveError ? 'text-danger' : dirty ? 'text-warning' : 'text-success'"
              :title="saveStatusText"
            >
              {{ saveStatusText }}
            </span>
            <button
              v-if="editable"
              type="button"
              class="inline-flex h-8 min-w-[76px] items-center justify-center gap-1.5 rounded border border-surface-border px-2.5 text-sm font-medium text-text-main transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!canSave"
              title="保存文件"
              @click="saveContent"
            >
              <span class="material-symbols-outlined text-lg">save</span>
              <span>{{ saving ? '保存中' : '保存' }}</span>
            </button>
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
                :disabled="saving"
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
