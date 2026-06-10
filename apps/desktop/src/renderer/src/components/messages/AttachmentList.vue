<script setup lang="ts">
import { ref, watch } from 'vue'
import type { GroupAttachmentView } from '../../api'
import { groupChatApi } from '../../api/group-chats'
import { formatBytes } from '../../utils/format'

type DisplayAttachment = GroupAttachmentView & {
  previewUrl?: string
}

const props = defineProps<{
  attachments?: GroupAttachmentView[]
  inverse?: boolean
}>()

const previewUrls = ref<Record<string, string>>({})
const previewLoading = ref<Record<string, boolean>>({})
const previewErrors = ref<Record<string, boolean>>({})

function isImageAttachment(attachment: GroupAttachmentView): boolean {
  return (
    attachment.mimeType.startsWith('image/') ||
    /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(attachment.originalName)
  )
}

function localPreviewUrl(attachment: GroupAttachmentView): string | null {
  return (attachment as DisplayAttachment).previewUrl ?? null
}

function resolvedPreviewUrl(attachment: GroupAttachmentView): string | null {
  return localPreviewUrl(attachment) ?? previewUrls.value[attachment.id] ?? null
}

function setPreviewLoading(id: string, loading: boolean): void {
  previewLoading.value = { ...previewLoading.value, [id]: loading }
}

function setPreviewError(id: string): void {
  previewErrors.value = { ...previewErrors.value, [id]: true }
}

function setPreviewUrl(id: string, url: string): void {
  previewUrls.value = { ...previewUrls.value, [id]: url }
}

function clearStalePreviewState(attachments: GroupAttachmentView[]): void {
  const ids = new Set(attachments.map((attachment) => attachment.id))
  previewUrls.value = Object.fromEntries(
    Object.entries(previewUrls.value).filter(([id]) => ids.has(id))
  )
  previewLoading.value = Object.fromEntries(
    Object.entries(previewLoading.value).filter(([id]) => ids.has(id))
  )
  previewErrors.value = Object.fromEntries(
    Object.entries(previewErrors.value).filter(([id]) => ids.has(id))
  )
}

function shouldShowImageCard(attachment: GroupAttachmentView): boolean {
  if (!isImageAttachment(attachment) || previewErrors.value[attachment.id]) return false
  return Boolean(
    resolvedPreviewUrl(attachment) ||
    attachment.workspacePath ||
    previewLoading.value[attachment.id]
  )
}

async function loadImagePreview(attachment: GroupAttachmentView): Promise<void> {
  if (
    !isImageAttachment(attachment) ||
    !attachment.workspacePath ||
    localPreviewUrl(attachment) ||
    previewUrls.value[attachment.id] ||
    previewLoading.value[attachment.id] ||
    previewErrors.value[attachment.id]
  ) {
    return
  }

  setPreviewLoading(attachment.id, true)
  try {
    const preview = await groupChatApi.getAttachmentPreview(attachment.groupChatId, attachment.id)
    if (preview.previewKind === 'image' && preview.dataUrl) {
      setPreviewUrl(attachment.id, preview.dataUrl)
    } else {
      setPreviewError(attachment.id)
    }
  } catch {
    setPreviewError(attachment.id)
  } finally {
    setPreviewLoading(attachment.id, false)
  }
}

function openImage(attachment: GroupAttachmentView): void {
  const url = resolvedPreviewUrl(attachment)
  if (!url) return
  window.open(url, '_blank', 'noopener,noreferrer')
}

watch(
  () =>
    (props.attachments ?? [])
      .map(
        (attachment) =>
          `${attachment.id}:${attachment.groupChatId}:${attachment.workspacePath ?? ''}:${attachment.mimeType}`
      )
      .join('|'),
  () => {
    const attachments = props.attachments ?? []
    clearStalePreviewState(attachments)
    for (const attachment of attachments) void loadImagePreview(attachment)
  },
  { immediate: true }
)
</script>

<template>
  <div v-if="props.attachments?.length" class="mt-2 space-y-2">
    <div v-for="attachment in props.attachments" :key="attachment.id">
      <button
        v-if="shouldShowImageCard(attachment)"
        type="button"
        class="block max-w-full overflow-hidden rounded-lg border text-left transition-colors"
        :class="
          inverse
            ? 'border-white/20 bg-white/15 text-white hover:bg-white/20'
            : 'border-surface-border bg-white text-text-main shadow-sm hover:border-primary/40'
        "
        :disabled="!resolvedPreviewUrl(attachment)"
        title="打开图片"
        @click="openImage(attachment)"
      >
        <div
          class="flex h-40 w-[280px] max-w-full items-center justify-center"
          :class="inverse ? 'bg-black/15' : 'bg-surface-hover'"
        >
          <img
            v-if="resolvedPreviewUrl(attachment)"
            :src="resolvedPreviewUrl(attachment) ?? undefined"
            :alt="attachment.originalName"
            class="h-full w-full object-contain"
          />
          <div v-else class="flex flex-col items-center gap-1 text-xs">
            <span class="material-symbols-outlined text-3xl">image</span>
            <span>{{ previewLoading[attachment.id] ? '加载中…' : '图片预览' }}</span>
          </div>
        </div>
        <span class="flex min-w-0 items-center gap-2 px-2.5 py-2 text-sm">
          <span class="material-symbols-outlined flex-shrink-0 text-xl">image</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ attachment.originalName }}</span>
            <span
              class="block truncate text-xs"
              :class="inverse ? 'text-white/75' : 'text-text-muted'"
            >
              {{ formatBytes(attachment.size) }}
              <template v-if="attachment.workspacePath"> · {{ attachment.workspacePath }}</template>
              <template v-else> · 发送后写入工作区</template>
            </span>
          </span>
        </span>
      </button>
      <div
        v-else
        class="flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
        :class="
          inverse
            ? 'border-white/20 bg-white/15 text-white'
            : 'border-surface-border bg-white text-text-main'
        "
      >
        <span class="material-symbols-outlined flex-shrink-0 text-xl">attach_file</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate font-medium">{{ attachment.originalName }}</span>
          <span
            class="block truncate text-xs"
            :class="inverse ? 'text-white/75' : 'text-text-muted'"
          >
            {{ formatBytes(attachment.size) }}
            <template v-if="attachment.workspacePath"> · {{ attachment.workspacePath }}</template>
            <template v-else> · 发送后写入工作区</template>
          </span>
        </span>
      </div>
    </div>
  </div>
</template>
