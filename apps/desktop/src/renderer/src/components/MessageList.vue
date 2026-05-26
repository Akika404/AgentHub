<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { ChatMessage } from '../api'
import SystemMessageView from './messages/SystemMessage.vue'
import TextMessageView from './messages/TextMessage.vue'
import TaskListMessageView from './messages/TaskListMessage.vue'
import OptionsMessageView from './messages/OptionsMessage.vue'

const props = defineProps<{
  messages: ChatMessage[]
  loading?: boolean
}>()

const scrollRef = ref<HTMLElement | null>(null)

watch(
  () => props.messages.length,
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
    <div v-if="loading" class="text-center text-text-muted text-[13px]">加载中...</div>
    <template v-for="msg in messages" :key="msg.id">
      <SystemMessageView v-if="msg.kind === 'system'" :message="msg" />
      <TextMessageView v-else-if="msg.kind === 'text'" :message="msg" />
      <TaskListMessageView v-else-if="msg.kind === 'task-list'" :message="msg" />
      <OptionsMessageView v-else-if="msg.kind === 'options'" :message="msg" />
    </template>
  </div>
</template>
