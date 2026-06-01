<script setup lang="ts">
// Pulsing placeholder block. Set width/height via the passed-through class
// (e.g. class="h-3 w-1/2"); `rounded` controls the corner shape.
withDefaults(defineProps<{ rounded?: 'sm' | 'md' | 'full' }>(), { rounded: 'md' })
</script>

<template>
  <div
    class="animate-pulse bg-gray-100"
    :class="rounded === 'full' ? 'rounded-full' : rounded === 'sm' ? 'rounded-sm' : 'rounded-md'"
  />
</template>
