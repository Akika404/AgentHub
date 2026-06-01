<script setup lang="ts">
// Standard text field. type / placeholder / disabled / events fall through to
// the native <input> via attribute inheritance.
const model = defineModel<string>()
withDefaults(defineProps<{ mono?: boolean; invalid?: boolean }>(), {
  mono: false,
  invalid: false
})
</script>

<template>
  <input
    v-model="model"
    :class="[
      'w-full h-10 px-3 rounded-md border bg-surface text-base outline-none transition focus:ring-2 disabled:bg-surface-hover disabled:text-text-muted',
      invalid
        ? 'border-danger focus:border-danger focus:ring-danger/20'
        : 'border-surface-border focus:border-primary focus:ring-primary/20',
      { 'font-mono': mono }
    ]"
  />
</template>
