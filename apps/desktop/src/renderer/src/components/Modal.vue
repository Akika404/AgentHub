<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import BaseButton from './ui/BaseButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title?: string
    /** max width in px for the dialog card */
    width?: number
  }>(),
  { width: 480 }
)

const emit = defineEmits<{ (e: 'close'): void }>()

function onKey(e: KeyboardEvent): void {
  if (props.open && e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal" appear>
      <div
        v-if="open"
        class="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-6"
        @mousedown.self="emit('close')"
      >
        <div
          class="modal-card bg-surface rounded-lg shadow-lg border border-gray-150 w-full flex flex-col max-h-[85vh]"
          :style="{ maxWidth: `${width}px` }"
        >
          <header
            v-if="title || $slots.header"
            class="flex items-center justify-between px-5 h-14 border-b border-surface-border flex-shrink-0"
          >
            <slot name="header">
              <h2 class="font-semibold text-text-main text-lg">{{ title }}</h2>
            </slot>
            <BaseButton variant="ghost" icon @click="emit('close')">
              <span class="material-symbols-outlined text-3xl">close</span>
            </BaseButton>
          </header>
          <div class="px-5 py-4 overflow-y-auto">
            <slot />
          </div>
          <footer
            v-if="$slots.footer"
            class="flex items-center justify-end gap-2 px-5 h-16 border-t border-surface-border flex-shrink-0"
          >
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
