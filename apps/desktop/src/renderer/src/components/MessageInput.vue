<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{ (e: 'send', text: string): void }>()

const text = ref('')

function submit(): void {
  const trimmed = text.value.trim()
  if (!trimmed) return
  emit('send', trimmed)
  text.value = ''
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    submit()
  }
}
</script>

<template>
  <div class="p-4 border-t border-surface-border bg-surface flex-shrink-0">
    <div class="flex flex-col">
      <div class="p-1">
        <textarea
          v-model="text"
          class="w-full h-[72px] p-0 resize-none border-none focus:ring-0 focus:outline-none text-[14px] text-text-main placeholder-[#8f959e] bg-transparent leading-[22px]"
          placeholder="Type a message or /command..."
          @keydown="onKey"
        />
      </div>
      <div class="flex items-center justify-between py-2">
        <div class="flex items-center space-x-2 text-[#8f959e]">
          <button
            class="hover:text-text-main hover:bg-[#f2f3f5] p-1.5 rounded-[6px] transition-colors flex items-center"
          >
            <span class="material-symbols-outlined text-[20px]">attach_file</span>
          </button>
          <button
            class="hover:text-text-main hover:bg-[#f2f3f5] p-1.5 rounded-[6px] transition-colors flex items-center"
          >
            <span class="material-symbols-outlined text-[20px]">code</span>
          </button>
        </div>
        <button
          class="bg-primary text-white px-5 py-1.5 rounded-[6px] text-[13px] font-medium flex items-center space-x-1.5 hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="!text.trim()"
          @click="submit"
        >
          <span>发送&nbsp;</span>
          <span class="material-symbols-outlined text-[16px]">send</span>
        </button>
      </div>
    </div>
  </div>
</template>
