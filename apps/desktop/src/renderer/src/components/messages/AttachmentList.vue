<script setup lang="ts">
import type { GroupAttachmentView } from '../../api'
import { formatBytes } from '../../utils/format'

defineProps<{
  attachments?: GroupAttachmentView[]
  inverse?: boolean
}>()
</script>

<template>
  <div v-if="attachments?.length" class="mt-2 space-y-1.5">
    <div
      v-for="attachment in attachments"
      :key="attachment.id"
      class="flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
      :class="
        inverse
          ? 'border-white/20 bg-white/15 text-white'
          : 'border-surface-border bg-white text-text-main'
      "
    >
      <span class="material-symbols-outlined text-xl flex-shrink-0">attach_file</span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">{{ attachment.originalName }}</span>
        <span class="block truncate text-xs" :class="inverse ? 'text-white/75' : 'text-text-muted'">
          {{ formatBytes(attachment.size) }}
          <template v-if="attachment.workspacePath"> · {{ attachment.workspacePath }}</template>
          <template v-else> · 发送后写入工作区</template>
        </span>
      </span>
    </div>
  </div>
</template>
