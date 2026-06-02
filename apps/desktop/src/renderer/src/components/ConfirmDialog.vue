<script setup lang="ts">
import Modal from './Modal.vue'
import BaseButton from './ui/BaseButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    confirmingLabel?: string
    cancelLabel?: string
    confirming?: boolean
    width?: number
  }>(),
  {
    confirmLabel: '确认',
    confirmingLabel: '处理中...',
    cancelLabel: '取消',
    confirming: false,
    width: 420
  }
)

const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm'): void }>()

function requestClose(): void {
  if (props.confirming) return
  emit('close')
}
</script>

<template>
  <Modal :open="open" :title="title" :width="width" @close="requestClose">
    <p class="text-sm leading-6 text-text-main">{{ message }}</p>

    <template #footer>
      <BaseButton variant="ghost" :disabled="confirming" @click="requestClose">
        {{ cancelLabel }}
      </BaseButton>
      <BaseButton variant="danger" :disabled="confirming" @click="emit('confirm')">
        {{ confirming ? confirmingLabel : confirmLabel }}
      </BaseButton>
    </template>
  </Modal>
</template>
