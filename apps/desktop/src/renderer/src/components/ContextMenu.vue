<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export interface MenuItem {
  id: string
  label: string
  icon: string
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'close'): void
}>()

const MENU_WIDTH = 168
const MENU_PADDING = 8

const viewport = ref({ w: window.innerWidth, h: window.innerHeight })

function onResize(): void {
  viewport.value = { w: window.innerWidth, h: window.innerHeight }
}

function onGlobalClick(e: MouseEvent): void {
  if (!props.open) return
  const target = e.target as HTMLElement | null
  if (target?.closest('[data-context-menu]')) return
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (props.open && e.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('mousedown', onGlobalClick, true)
  window.addEventListener('contextmenu', onGlobalClick, true)
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('mousedown', onGlobalClick, true)
  window.removeEventListener('contextmenu', onGlobalClick, true)
  window.removeEventListener('keydown', onKey)
})

watch(
  () => props.open,
  (v) => {
    if (v) onResize()
  }
)

const position = computed(() => {
  const itemH = 36
  const estH = props.items.length * itemH + 8
  const maxX = viewport.value.w - MENU_WIDTH - MENU_PADDING
  const maxY = viewport.value.h - estH - MENU_PADDING
  return {
    left: Math.max(MENU_PADDING, Math.min(props.x, maxX)) + 'px',
    top: Math.max(MENU_PADDING, Math.min(props.y, maxY)) + 'px'
  }
})

function onPick(item: MenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-context-menu
      class="fixed z-50 bg-white border border-surface-border rounded-md shadow-card py-1"
      :style="{ ...position, width: `${MENU_WIDTH}px` }"
      @contextmenu.prevent
    >
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        :disabled="item.disabled"
        class="w-full flex items-center space-x-2.5 px-3 py-2 text-left text-base text-text-main hover:bg-surface-hover disabled:text-gray-400 disabled:hover:bg-transparent transition-colors"
        @click="onPick(item)"
      >
        <span class="material-symbols-outlined text-2xl text-text-muted">{{ item.icon }}</span>
        <span class="flex-1">{{ item.label }}</span>
      </button>
    </div>
  </Teleport>
</template>
