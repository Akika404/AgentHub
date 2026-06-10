<script setup lang="ts">
import { computed } from 'vue'
import type { BlackboardArtifact } from '../../api'
import type { DeployMessage } from '../../types/chatDisplay'
import { formatTime } from '../../utils/format'
import BaseButton from '../ui/BaseButton.vue'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: DeployMessage }>()

const emit = defineEmits<{
  (e: 'preview-artifact', artifact: BlackboardArtifact): void
  (e: 'edit-artifact', artifact: BlackboardArtifact): void
  (e: 'run-deployment', message: DeployMessage): void
}>()

const isService = computed(() => props.message.manifest.mode === 'service')

/** Static mode previews the declared entry artifact; fall back to the first listed one. */
const entryArtifact = computed<BlackboardArtifact | null>(() => {
  const { manifest, artifacts } = props.message
  if (manifest.entryPath) {
    const match = artifacts.find((a) => a.path === manifest.entryPath)
    if (match) return match
  }
  return artifacts[0] ?? null
})

function fileName(path: string): string {
  return path.split(/[\\/]+/).pop() ?? path
}
</script>

<template>
  <div class="flex space-x-3">
    <SenderAvatar :sender="message.sender" />
    <div class="flex flex-col max-w-[80%] w-full">
      <div class="flex items-center space-x-2 mb-1 ml-1">
        <span class="text-sm font-semibold text-text-main">{{ message.sender.name }}</span>
        <span class="text-sm text-text-muted">{{ formatTime(message.timestamp) }}</span>
      </div>
      <div
        class="bg-surface border border-surface-border p-4 rounded-xl rounded-tl-sm w-full max-w-md shadow-sm"
      >
        <div class="flex items-center gap-2 mb-1">
          <span class="material-symbols-outlined text-xl text-primary">
            {{ isService ? 'rocket_launch' : 'preview' }}
          </span>
          <span class="font-semibold text-text-main text-md">
            {{ isService ? '可运行的项目' : '可预览的产物' }}
          </span>
        </div>
        <p v-if="message.manifest.note" class="text-sm text-text-muted mb-3">
          {{ message.manifest.note }}
        </p>
        <p v-else class="text-sm text-text-muted mb-3">
          {{
            isService
              ? '本轮交付了一个需要运行的网页项目，运行后可在侧边栏预览。'
              : '本轮交付了可直接预览的产物。'
          }}
        </p>

        <!-- service：展示将要执行的命令 + 运行按钮 -->
        <template v-if="isService">
          <div
            class="rounded-md border border-surface-border bg-[#101418] px-3 py-2 font-mono text-xs leading-5 text-[#e8edf2] mb-3 space-y-0.5 break-all"
          >
            <div v-if="message.manifest.installCommand">
              <span class="text-text-muted select-none">$ </span
              >{{ message.manifest.installCommand }}
            </div>
            <div>
              <span class="text-text-muted select-none">$ </span>{{ message.manifest.command }}
            </div>
            <div v-if="message.manifest.port" class="text-[#7a8694]">
              # 端口 {{ message.manifest.port }} → localhost:{{ message.manifest.port }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <BaseButton variant="primary" size="sm" @click="emit('run-deployment', message)">
              <span class="material-symbols-outlined text-md mr-1">play_arrow</span>
              运行并预览
            </BaseButton>
          </div>
          <p class="text-xs text-text-muted mt-2">
            将在本机群工作区执行上述命令。仅本机可访问，运行中可随时停止。
          </p>
        </template>

        <!-- static：直接预览入口文件 -->
        <template v-else>
          <div class="space-y-1.5 mb-1">
            <div
              v-for="artifact in message.artifacts"
              :key="artifact.id"
              class="flex overflow-hidden rounded-md border border-surface-border bg-white transition-colors hover:border-primary hover:bg-primary-soft/40"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left"
                title="预览文件"
                @click="emit('preview-artifact', artifact)"
              >
                <span class="material-symbols-outlined text-md text-text-muted">draft</span>
                <span class="text-md text-text-main truncate flex-1">{{
                  fileName(artifact.path)
                }}</span>
                <span class="material-symbols-outlined text-md text-primary">preview</span>
              </button>
              <button
                type="button"
                class="flex w-9 flex-shrink-0 items-center justify-center border-l border-surface-border text-text-muted transition-colors hover:bg-primary-soft hover:text-primary"
                title="编辑文件"
                @click="emit('edit-artifact', artifact)"
              >
                <span class="material-symbols-outlined text-md">edit</span>
              </button>
            </div>
          </div>
          <BaseButton
            v-if="entryArtifact"
            variant="primary"
            size="sm"
            class="mt-2"
            @click="emit('preview-artifact', entryArtifact)"
          >
            <span class="material-symbols-outlined text-md mr-1">preview</span>
            预览
          </BaseButton>
        </template>
      </div>
    </div>
  </div>
</template>
