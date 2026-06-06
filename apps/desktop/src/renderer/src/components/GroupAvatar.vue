<script setup lang="ts">
import { computed } from 'vue'
import { agentInitials, avatarTextColor, normalizeAgentColor } from '../utils/avatar'

export interface GroupAvatarMember {
  name: string
  avatar?: string | null
  color?: string | null
}

const props = withDefaults(
  defineProps<{
    members: GroupAvatarMember[]
    title?: string
    size?: 'sm' | 'md' | 'lg'
  }>(),
  {
    title: '群聊',
    size: 'md'
  }
)

const visibleMembers = computed(() => props.members.slice(0, 9))
const tileColumns = computed(() => {
  const count = visibleMembers.value.length
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
})

const sizeClasses = {
  sm: 'h-8 w-8 rounded-md p-[2px]',
  md: 'h-10 w-10 rounded-md p-[3px]',
  lg: 'h-14 w-14 rounded-lg p-1'
}

const textClasses = {
  sm: 'text-[7px]',
  md: 'text-[8px]',
  lg: 'text-[10px]'
}

const fallbackMembers = computed<GroupAvatarMember[]>(() =>
  visibleMembers.value.length > 0
    ? visibleMembers.value
    : [{ name: props.title, avatar: null, color: '#8f99a8' }]
)

function tileStyle(member: GroupAvatarMember): { backgroundColor: string; color: string } {
  const backgroundColor = normalizeAgentColor(member.color)
  return {
    backgroundColor,
    color: avatarTextColor(backgroundColor)
  }
}

const gapBySize = {
  sm: '2px',
  md: '2px',
  lg: '3px'
}

const layoutStyle = computed(() => ({
  gap: gapBySize[props.size]
}))

const tileSizeStyle = computed(() => ({
  flexBasis: `calc((100% - ${gapBySize[props.size]} * ${tileColumns.value - 1}) / ${tileColumns.value})`
}))
</script>

<template>
  <div
    class="flex flex-shrink-0 flex-wrap content-center items-center justify-center overflow-hidden bg-[#dde2e8] shadow-sm"
    :class="sizeClasses[size]"
    :style="layoutStyle"
    :title="title"
  >
    <div
      v-for="(member, index) in fallbackMembers"
      :key="`${member.name}-${index}`"
      class="flex aspect-square min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[3px] bg-white font-semibold leading-none"
      :class="textClasses[size]"
      :style="member.avatar ? tileSizeStyle : [tileSizeStyle, tileStyle(member)]"
    >
      <img
        v-if="member.avatar"
        :src="member.avatar"
        :alt="member.name"
        class="h-full w-full object-contain"
      />
      <span v-else class="whitespace-nowrap">{{ agentInitials(member.name) }}</span>
    </div>
  </div>
</template>
