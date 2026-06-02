<script setup lang="ts" generic="T extends string">
import { useAttrs } from 'vue'

// Native <select> styled to match BaseInput. Generic over the option value type
// so callers keep their union types (AgentVendor, ProviderType, …). Pass the
// <option>s via the default slot; disabled falls through.
defineOptions({ inheritAttrs: false })

const model = defineModel<T>()
const attrs = useAttrs()
withDefaults(defineProps<{ invalid?: boolean }>(), { invalid: false })
</script>

<template>
  <div class="relative w-full">
    <select
      v-bind="attrs"
      v-model="model"
      :class="[
        'peer w-full h-10 appearance-none rounded-md border bg-surface pl-3 pr-9 text-base outline-none transition focus:ring-2 disabled:bg-surface-hover disabled:text-text-muted',
        invalid
          ? 'border-danger focus:border-danger focus:ring-danger/20'
          : 'border-surface-border focus:border-primary focus:ring-primary/20'
      ]"
    >
      <slot />
    </select>
    <span
      class="material-symbols-outlined pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xl text-gray-600 peer-disabled:text-text-muted"
    >
      expand_more
    </span>
  </div>
</template>
