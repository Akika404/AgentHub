<script setup lang="ts">
// Multi-line field. rows / placeholder / disabled fall through to <textarea>.
const model = defineModel<string>()
withDefaults(defineProps<{ mono?: boolean; invalid?: boolean }>(), {
  mono: false,
  invalid: false
})
</script>

<template>
  <textarea
    v-model="model"
    :class="[
      'w-full px-3 py-2 rounded-md border bg-surface text-base outline-none transition resize-y focus:ring-2 disabled:bg-surface-hover disabled:text-text-muted',
      invalid
        ? 'border-danger focus:border-danger focus:ring-danger/20'
        : 'border-surface-border focus:border-primary focus:ring-primary/20',
      { 'font-mono': mono }
    ]"
  />
</template>
