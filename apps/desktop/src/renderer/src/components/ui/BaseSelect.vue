<script setup lang="ts" generic="T extends string">
// Native <select> styled to match BaseInput. Generic over the option value type
// so callers keep their union types (AgentVendor, ProviderType, …). Pass the
// <option>s via the default slot; disabled falls through.
const model = defineModel<T>()
withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })
</script>

<template>
  <select
    v-model="model"
    :class="[
      'w-full h-10 px-3 rounded-md border bg-surface text-base outline-none transition focus:ring-2 disabled:bg-surface-hover disabled:text-text-muted',
      invalid
        ? 'border-danger focus:border-danger focus:ring-danger/20'
        : 'border-surface-border focus:border-primary focus:ring-primary/20'
    ]"
  >
    <slot />
  </select>
</template>
