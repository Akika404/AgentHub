<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { BlackboardView, GroupChatView } from '../api'
import { ApiError } from '../api'
import { groupChatApi } from '../api/group-chats'
import GroupAvatar from '../components/GroupAvatar.vue'
import GroupDetailPanel from '../components/GroupDetailPanel.vue'
import GroupChatCreateDialog from '../components/GroupChatCreateDialog.vue'
import BaseButton from '../components/ui/BaseButton.vue'
import BaseSkeleton from '../components/ui/BaseSkeleton.vue'

const props = defineProps<{ openCreateSignal?: number }>()

const groups = ref<GroupChatView[]>([])
const groupsLoading = ref(false)
const detailLoading = ref(false)
const blackboardLoading = ref(false)
const activeGroupId = ref<string | null>(null)
const activeGroup = ref<GroupChatView | null>(null)
const blackboard = ref<BlackboardView | null>(null)
const errorText = ref<string | null>(null)
const createOpen = ref(false)

async function loadGroups(): Promise<void> {
  groupsLoading.value = true
  errorText.value = null
  try {
    groups.value = await groupChatApi.list()
    const currentStillExists = groups.value.some((group) => group.id === activeGroupId.value)
    const initial = currentStillExists ? activeGroupId.value : groups.value[0]?.id
    if (initial) await selectGroup(initial)
    else {
      activeGroupId.value = null
      activeGroup.value = null
      blackboard.value = null
    }
  } catch (err) {
    errorText.value = err instanceof ApiError ? err.message : '加载群聊失败'
  } finally {
    groupsLoading.value = false
  }
}

async function selectGroup(id: string): Promise<void> {
  activeGroupId.value = id
  detailLoading.value = true
  blackboardLoading.value = true
  blackboard.value = null
  errorText.value = null
  try {
    const [groupDetail, board] = await Promise.all([
      groupChatApi.get(id),
      groupChatApi.getBlackboard(id).catch(() => null)
    ])
    activeGroup.value = groupDetail
    blackboard.value = board
    groups.value = groups.value.map((group) => (group.id === id ? groupDetail : group))
  } catch (err) {
    errorText.value = err instanceof ApiError ? err.message : '加载群聊资料失败'
    activeGroup.value = groups.value.find((group) => group.id === id) ?? null
  } finally {
    detailLoading.value = false
    blackboardLoading.value = false
  }
}

async function onCreated(group: GroupChatView): Promise<void> {
  createOpen.value = false
  groups.value = [group, ...groups.value.filter((item) => item.id !== group.id)]
  await selectGroup(group.id)
}

watch(
  () => props.openCreateSignal,
  (v) => {
    if (v) createOpen.value = true
  }
)

onMounted(loadGroups)
</script>

<template>
  <div class="flex h-full flex-1 overflow-hidden">
    <aside class="flex w-[280px] flex-shrink-0 flex-col border-r border-surface-border bg-surface">
      <header class="flex h-14 items-center justify-between px-4">
        <div class="min-w-0">
          <h2 class="truncate text-md font-semibold text-text-main">群聊资料</h2>
          <p class="truncate text-xs text-text-muted">成员、目标、黑板</p>
        </div>
        <BaseButton variant="ghost" icon title="创建群聊" @click="createOpen = true">
          <span class="material-symbols-outlined text-2xl">add</span>
        </BaseButton>
      </header>

      <div class="flex-1 overflow-y-auto px-2 pb-3">
        <div v-if="groupsLoading" class="space-y-2 px-1">
          <BaseSkeleton v-for="i in 5" :key="i" class="h-14 w-full" />
        </div>
        <p v-else-if="groups.length === 0" class="px-3 py-8 text-center text-sm text-text-muted">
          还没有群聊，点右上角 + 创建。
        </p>
        <button
          v-for="group in groups"
          :key="group.id"
          type="button"
          class="mb-1 flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors"
          :class="
            activeGroupId === group.id
              ? 'bg-surface-active text-primary'
              : 'text-text-main hover:bg-surface-hover'
          "
          @click="selectGroup(group.id)"
        >
          <GroupAvatar :members="group.members" :title="group.title" />
          <span class="min-w-0 flex-1">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-base font-medium">{{ group.title }}</span>
              <span
                class="flex-shrink-0 rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary"
              >
                群聊
              </span>
            </span>
            <span class="mt-0.5 block truncate text-xs text-text-muted">
              {{ group.members.length }} 成员 · {{ group.projectMeta.name }}
            </span>
          </span>
          <span
            v-if="group.activeRunId"
            class="h-2 w-2 flex-shrink-0 rounded-full bg-success"
            title="运行中"
          />
        </button>
      </div>

      <p v-if="errorText" class="border-t border-surface-border px-4 py-3 text-sm text-danger">
        {{ errorText }}
      </p>
    </aside>

    <GroupDetailPanel
      :group="activeGroup"
      :blackboard="blackboard"
      :loading="detailLoading"
      :blackboard-loading="blackboardLoading"
    />

    <GroupChatCreateDialog :open="createOpen" @close="createOpen = false" @created="onCreated" />
  </div>
</template>
