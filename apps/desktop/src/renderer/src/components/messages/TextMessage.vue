<script setup lang="ts">
import { computed } from 'vue'
import type { TextMessage } from '../../api'
import { formatTime } from '../../utils/format'
import { renderMarkdown } from '../../utils/markdown'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: TextMessage }>()

const isSelf = (): boolean =>
  props.message.sender.role === 'user' && props.message.sender.id === 'me'

const renderedHtml = computed(() => renderMarkdown(props.message.text))
</script>

<template>
  <div v-if="isSelf()" class="flex justify-end space-x-3">
    <div class="flex flex-col items-end max-w-[70%]">
      <div
        class="bg-primary border border-white/20 text-white p-3 rounded-xl rounded-tr-sm text-md font-medium whitespace-pre-wrap break-words"
      >
        <div
          v-if="message.replyTo"
          class="mb-2 px-2.5 py-1.5 rounded bg-white/15 border-l-2 border-white/60 text-sm leading-[18px]"
        >
          <div class="font-semibold opacity-90">回复 {{ message.replyTo.senderName }}</div>
          <div class="opacity-80 line-clamp-2 break-words">{{ message.replyTo.excerpt }}</div>
        </div>
        <span v-text="message.text"></span>
      </div>
      <span class="text-sm text-text-muted mt-1">{{ formatTime(message.timestamp) }}</span>
    </div>
    <SenderAvatar :sender="message.sender" />
  </div>
  <div v-else class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%]">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-sm font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-sm text-text-muted">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface-hover border border-surface-border p-3 rounded-xl rounded-tl-sm text-md font-medium break-words"
      >
        <div
          v-if="message.replyTo"
          class="mb-2 px-2.5 py-1.5 rounded bg-white border-l-2 border-primary text-sm leading-[18px] text-text-muted"
        >
          <div class="font-semibold text-text-main">回复 {{ message.replyTo.senderName }}</div>
          <div class="line-clamp-2 break-words">{{ message.replyTo.excerpt }}</div>
        </div>
        <div class="markdown-body" v-html="renderedHtml"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Markdown body inside the light (other-party) bubble. Scoped + :deep so it
   only styles rendered markdown, never leaks to the rest of the app. Colors map
   to the design-system tokens (primary / gray-* / surface-border). */
.markdown-body {
  font-weight: 400;
  line-height: 1.6;
  word-break: break-word;
}
.markdown-body :deep(> *:first-child) {
  margin-top: 0;
}
.markdown-body :deep(> *:last-child) {
  margin-bottom: 0;
}
.markdown-body :deep(p) {
  margin: 0 0 8px;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  margin: 12px 0 6px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body :deep(h1) {
  font-size: 18px;
}
.markdown-body :deep(h2) {
  font-size: 16px;
}
.markdown-body :deep(h3) {
  font-size: 15px;
}
.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 14px;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.markdown-body :deep(li) {
  margin: 2px 0;
}
.markdown-body :deep(li > ul),
.markdown-body :deep(li > ol) {
  margin: 2px 0;
}
.markdown-body :deep(a) {
  color: #3370ff;
  text-decoration: none;
}
.markdown-body :deep(a:hover) {
  text-decoration: underline;
}
.markdown-body :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f2f3f5;
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}
.markdown-body :deep(pre) {
  margin: 0 0 8px;
  padding: 10px 12px;
  border: 1px solid #dee0e3;
  border-radius: 8px;
  background: #f8f9fa;
  overflow-x: auto;
}
.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  font-size: 12px;
  line-height: 1.5;
}
.markdown-body :deep(blockquote) {
  margin: 0 0 8px;
  padding: 2px 12px;
  border-left: 3px solid #dee0e3;
  color: #646a73;
}
.markdown-body :deep(hr) {
  margin: 12px 0;
  border: 0;
  border-top: 1px solid #dee0e3;
}
.markdown-body :deep(table) {
  margin: 0 0 8px;
  border-collapse: collapse;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  padding: 4px 10px;
  border: 1px solid #dee0e3;
}
.markdown-body :deep(th) {
  background: #f2f3f5;
  font-weight: 600;
}
.markdown-body :deep(img) {
  max-width: 100%;
  border-radius: 6px;
}
</style>
