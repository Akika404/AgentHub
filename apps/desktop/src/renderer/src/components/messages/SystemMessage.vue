<script setup lang="ts">
import type { SystemMessage } from '../../api'

defineProps<{ message: SystemMessage }>()
</script>

<template>
  <div class="flex justify-center">
    <span class="bg-surface-hover text-text-muted text-sm px-3 py-1 rounded-[6px]">
      {{ message.text }}
    </span>
  </div>
</template>
