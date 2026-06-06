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
const gridClass = computed(() => {
  const count = visibleMembers.value.length
  if (count <= 1) return 'grid-cols-1'
  if (count <= 4) return 'grid-cols-2'
  return 'grid-cols-3'
})

const sizeClasses = {
  sm: 'h-8 w-8 rounded-md p-[2px] gap-[2px]',
  md: 'h-10 w-10 rounded-md p-[3px] gap-[2px]',
  lg: 'h-14 w-14 rounded-lg p-1 gap-[3px]'
}

const textClasses = {
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-xs'
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
</script>

<template>
  <div
    class="grid flex-shrink-0 overflow-hidden bg-[#dde2e8] shadow-sm"
    :class="[sizeClasses[size], gridClass]"
    :title="title"
  >
    <div
      v-for="(member, index) in fallbackMembers"
      :key="`${member.name}-${index}`"
      class="flex min-h-0 min-w-0 items-center justify-center overflow-hidden rounded-[3px] font-semibold leading-none"
      :class="textClasses[size]"
      :style="member.avatar ? undefined : tileStyle(member)"
    >
      <img
        v-if="member.avatar"
        :src="member.avatar"
        :alt="member.name"
        class="h-full w-full object-cover"
      />
      <span v-else>{{ agentInitials(member.name) }}</span>
    </div>
  </div>
</template>
