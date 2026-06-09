<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import type { BlackboardArtifactPreview } from '../api'

const props = defineProps<{
  preview: BlackboardArtifactPreview | null
  loading: boolean
  errorText: string | null
}>()

const htmlPreviewUrl = ref<string | null>(null)

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

// Serve HTML over a custom scheme rather than a blob: URL — blob documents
// inherit the renderer's strict CSP (`script-src 'self'`), which silently
// blocks the inlined scripts and leaves only static markup rendered.
watch(
  () => (props.preview?.previewKind === 'html' ? props.preview.content : null),
  async (html) => {
    clearHtmlPreviewUrl()
    if (html == null) return
    htmlPreviewUrl.value = await window.api.registerPreviewHtml(html)
  },
  { immediate: true }
)

onUnmounted(clearHtmlPreviewUrl)
</script>

<template>
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
      <pre
        v-if="preview.previewKind === 'text'"
        class="h-full overflow-auto bg-[#101418] p-4 font-mono text-sm leading-6 text-[#e8edf2]"
        >{{ preview.content }}</pre
      >

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
</template>
