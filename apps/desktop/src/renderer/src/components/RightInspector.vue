<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NetworkNode, NetworkNodeStatus } from '../api'

const props = defineProps<{ network: NetworkNode[] }>()

type Tab = 'status' | 'workspace'
const tab = ref<Tab>('status')

interface TreeNode extends NetworkNode {
  children: TreeNode[]
}

const tree = computed<TreeNode[]>(() => {
  const map = new Map<string, TreeNode>()
  props.network.forEach((n) => map.set(n.id, { ...n, children: [] }))
  const roots: TreeNode[] = []
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
})

const dotClasses: Record<NetworkNodeStatus, string> = {
  active: 'bg-success',
  working: 'bg-primary',
  idle: 'bg-surface-border'
}
</script>

<template>
  <aside
    class="w-[300px] h-full border-l border-surface-border bg-surface flex flex-col flex-shrink-0 z-10"
  >
    <div class="flex p-1 bg-surface-hover m-4 rounded">
      <button
        class="flex-1 py-1 text-base font-medium rounded-sm transition-all"
        :class="
          tab === 'status'
            ? 'bg-white text-text-main shadow-sm'
            : 'text-text-muted hover:text-text-main'
        "
        @click="tab = 'status'"
      >
        Status
      </button>
      <button
        class="flex-1 py-1 text-base font-medium rounded-sm transition-all"
        :class="
          tab === 'workspace'
            ? 'bg-white text-text-main shadow-sm'
            : 'text-text-muted hover:text-text-main'
        "
        @click="tab = 'workspace'"
      >
        WorkSpace
      </button>
    </div>

    <div v-if="tab === 'status'" class="flex-1 overflow-y-auto px-5 py-2">
      <div class="text-md font-semibold text-text-main mb-5">当前协作网络</div>
      <div v-if="!tree.length" class="text-base text-text-muted">暂无协作节点</div>
      <div class="space-y-1">
        <template v-for="root in tree" :key="root.id">
          <div class="flex items-center space-x-2.5 py-1">
            <div
              class="w-3 h-3 rounded-full flex-shrink-0"
              :class="[
                dotClasses[root.status],
                root.status === 'active' ? 'animate-pulse-ring' : ''
              ]"
            ></div>
            <span class="text-md font-medium text-text-main">{{ root.name }}</span>
          </div>
          <div
            v-if="root.children.length"
            class="ml-[6px] pl-[14px] border-l border-surface-border space-y-1"
          >
            <div v-for="child in root.children" :key="child.id">
              <div class="flex items-center space-x-2.5 py-1">
                <span
                  class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  :class="dotClasses[child.status]"
                ></span>
                <span class="text-base text-text-main">{{ child.name }}</span>
              </div>
              <div
                v-if="child.children.length"
                class="ml-[5px] pl-[12px] border-l border-surface-border space-y-1"
              >
                <div
                  v-for="grand in child.children"
                  :key="grand.id"
                  class="flex items-center space-x-2.5 py-1"
                >
                  <span
                    class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    :class="dotClasses[grand.status]"
                  ></span>
                  <span class="text-base text-text-main">{{ grand.name }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-else class="flex-1 overflow-y-auto px-5 py-2 text-base text-text-muted">
      WorkSpace 暂未实现
    </div>
  </aside>
</template>
