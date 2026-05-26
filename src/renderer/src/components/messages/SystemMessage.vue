<script setup lang="ts">
import type { SystemMessage } from '../../api'

defineProps<{ message: SystemMessage }>()
</script>

<template>
  <div class="flex justify-center">
    <span class="bg-[#f2f3f5] text-[#8f959e] text-[12px] px-3 py-1 rounded-[6px]">
      {{ message.text }}
    </span>
  </div>
</template>
