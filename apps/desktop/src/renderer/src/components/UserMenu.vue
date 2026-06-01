<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UserView } from '@agenthub/shared'
import { ApiError } from '../api'
import { logout, updateProfile, userToAvatar } from '../stores/auth'
import Modal from './Modal.vue'
import BaseInput from './ui/BaseInput.vue'

const props = defineProps<{ user: UserView | null }>()

const menuOpen = ref(false)
const nicknameOpen = ref(false)
const nickname = ref('')
const nicknameError = ref<string | null>(null)
const saving = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function toggleMenu(): void {
  menuOpen.value = !menuOpen.value
}

function onGlobalClick(e: MouseEvent): void {
  if (!menuOpen.value) return
  if (!rootRef.value?.contains(e.target as Node)) menuOpen.value = false
}

onMounted(() => window.addEventListener('mousedown', onGlobalClick, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onGlobalClick, true))

function openNickname(): void {
  menuOpen.value = false
  nickname.value = props.user?.nickname ?? ''
  nicknameError.value = null
  nicknameOpen.value = true
}

async function saveNickname(): Promise<void> {
  const value = nickname.value.trim()
  saving.value = true
  nicknameError.value = null
  try {
    await updateProfile({ nickname: value === '' ? null : value })
    nicknameOpen.value = false
  } catch (err) {
    nicknameError.value = err instanceof ApiError ? err.message : '更新失败，请重试'
  } finally {
    saving.value = false
  }
}

function pickAvatar(): void {
  menuOpen.value = false
  fileInput.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = async () => {
    const result = reader.result
    if (typeof result !== 'string') return
    try {
      await updateProfile({ avatar: result })
    } catch {
      /* surfaced elsewhere; avoid blocking the sidebar */
    }
  }
  reader.readAsDataURL(file)
}

async function onLogout(): Promise<void> {
  menuOpen.value = false
  await logout()
}
</script>

<template>
  <div ref="rootRef" class="relative flex items-center justify-center w-full">
    <button
      type="button"
      class="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-white font-semibold text-md focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow"
      :class="user?.avatar ? 'bg-surface-hover' : 'bg-gradient-to-br from-primary to-accent'"
      :title="userToAvatar(user)?.name ?? '账号'"
      @click="toggleMenu"
    >
      <img
        v-if="user?.avatar"
        :src="user.avatar"
        :alt="userToAvatar(user)?.name"
        class="w-full h-full object-cover"
      />
      <span v-else>{{ userToAvatar(user)?.initials?.charAt(0) ?? 'U' }}</span>
    </button>

    <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onFileChange" />

    <div
      v-if="menuOpen"
      class="absolute left-[52px] top-0 z-50 w-44 bg-surface border border-surface-border rounded-[8px] shadow-card py-1.5"
    >
      <div class="px-3 py-1.5 border-b border-surface-border mb-1">
        <p class="text-base font-medium text-text-main truncate">
          {{ userToAvatar(user)?.name ?? '账号' }}
        </p>
        <p v-if="user" class="text-xs text-text-muted truncate">@{{ user.account }}</p>
      </div>
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-base text-text-main hover:bg-surface-hover transition-colors"
        @click="openNickname"
      >
        <span class="material-symbols-outlined text-2xl text-text-muted">edit</span>
        <span>更新昵称</span>
      </button>
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-base text-text-main hover:bg-surface-hover transition-colors"
        @click="pickAvatar"
      >
        <span class="material-symbols-outlined text-2xl text-text-muted">image</span>
        <span>更换头像</span>
      </button>
      <button
        type="button"
        class="w-full flex items-center gap-2.5 px-3 py-2 text-left text-base text-danger hover:bg-surface-hover transition-colors"
        @click="onLogout"
      >
        <span class="material-symbols-outlined text-2xl">logout</span>
        <span>退出登录</span>
      </button>
    </div>

    <Modal :open="nicknameOpen" title="更新昵称" :width="380" @close="nicknameOpen = false">
      <label class="block text-sm text-text-muted mb-1.5">昵称</label>
      <BaseInput
        v-model="nickname"
        type="text"
        maxlength="64"
        placeholder="留空则清除昵称"
        @keydown.enter="saveNickname"
      />
      <p v-if="nicknameError" class="text-sm text-danger mt-2">{{ nicknameError }}</p>
      <template #footer>
        <button
          type="button"
          class="h-9 px-4 rounded-[8px] text-base text-text-main hover:bg-surface-hover transition-colors"
          @click="nicknameOpen = false"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="saving"
          class="h-9 px-4 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-base font-medium transition-colors disabled:opacity-60"
          @click="saveNickname"
        >
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </Modal>
  </div>
</template>
