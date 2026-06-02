<script setup lang="ts">
import { computed } from 'vue'
import { agentInitials, avatarTextColor, normalizeAgentColor } from '../utils/avatar'

const props = withDefaults(
  defineProps<{
    name: string
    avatar?: string | null
    color?: string | null
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    avatar: null,
    color: null,
    size: 'md'
  }
)

const sizeClasses = {
  sm: 'w-8 h-8 rounded-md text-sm',
  md: 'w-10 h-10 rounded-md text-md',
  lg: 'w-14 h-14 rounded-lg text-xl'
}

const fallbackStyle = computed(() => {
  const backgroundColor = normalizeAgentColor(props.color)
  return {
    backgroundColor,
    color: avatarTextColor(backgroundColor)
  }
})
</script>

<template>
  <div
    class="flex flex-shrink-0 items-center justify-center overflow-hidden font-semibold shadow-sm"
    :class="sizeClasses[size]"
    :style="avatar ? undefined : fallbackStyle"
  >
    <img v-if="avatar" :src="avatar" :alt="name" class="h-full w-full object-cover" />
    <span v-else>{{ agentInitials(name) }}</span>
  </div>
</template>
