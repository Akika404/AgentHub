<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { UserView } from '@agenthub/shared'
import { ApiError } from '../api'
import { logout, updateProfile, userToAvatar } from '../stores/auth'
import Modal from './Modal.vue'
import BaseInput from './ui/BaseInput.vue'
import BaseButton from './ui/BaseButton.vue'

const props = defineProps<{ user: UserView | null }>()

const menuOpen = ref(false)
const nicknameOpen = ref(false)
const nickname = ref('')
const nicknameError = ref<string | null>(null)
const saving = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const AVATAR_CANVAS_SIZE = 256
const AVATAR_MAX_DATA_URL_LENGTH = 256 * 1024
const AVATAR_QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6]

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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Invalid avatar file'))
    }
    reader.onerror = () => reject(new Error('Failed to read avatar file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Invalid avatar image'))
    image.src = src
  })
}

async function createAvatarDataUrl(file: File): Promise<string> {
  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_CANVAS_SIZE
  canvas.height = AVATAR_CANVAS_SIZE

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const sourceSize = Math.min(width, height)
  const sourceX = (width - sourceSize) / 2
  const sourceY = (height - sourceSize) / 2

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE)
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CANVAS_SIZE,
    AVATAR_CANVAS_SIZE
  )

  for (const quality of AVATAR_QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= AVATAR_MAX_DATA_URL_LENGTH) return dataUrl
  }

  throw new Error('Avatar image is too large')
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !file.type.startsWith('image/')) return
  void createAvatarDataUrl(file)
    .then((avatar) => updateProfile({ avatar }))
    .catch((err) => {
      console.warn('Failed to update avatar', err)
      /* surfaced elsewhere; avoid blocking the sidebar */
    })
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

    <Transition name="pop">
      <div
        v-if="menuOpen"
        class="absolute left-[52px] top-0 z-50 w-44 bg-surface border border-gray-150 rounded-md shadow-md py-1.5"
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
    </Transition>

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
        <BaseButton variant="ghost" @click="nicknameOpen = false">取消</BaseButton>
        <BaseButton :disabled="saving" @click="saveNickname">
          {{ saving ? '保存中…' : '保存' }}
        </BaseButton>
      </template>
    </Modal>
  </div>
</template>
