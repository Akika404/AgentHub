<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { MessageReplyRef } from '../api'
import type { MentionTarget } from '../types/mentions'
import { formatBytes } from '../utils/format'
import AgentAvatar from './AgentAvatar.vue'
import BaseButton from './ui/BaseButton.vue'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_ATTACHMENTS = 5
const DEFAULT_ATTACHMENT_ONLY_TEXT = '请阅读并处理上传的文件。'

const props = defineProps<{
  replyTo?: MessageReplyRef | null
  disabled?: boolean
  disabledReason?: string
  streaming?: boolean
  mentionTargets?: MentionTarget[]
  attachmentsEnabled?: boolean
}>()

const emit = defineEmits<{
  (
    e: 'send',
    payload: { text: string; replyTo?: MessageReplyRef; mentions?: string[]; files?: File[] }
  ): void
  (e: 'cancel-reply'): void
  (e: 'stop'): void
}>()

const text = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const isComposing = ref(false)
const attachmentError = ref<string | null>(null)
const dragActive = ref(false)
const files = ref<File[]>([])
const mentionTrigger = ref<{ start: number; query: string } | null>(null)
const highlightedMentionIndex = ref(0)

const normalizedMentionTargets = computed(() =>
  (props.mentionTargets ?? [])
    .map((target) => ({ ...target, label: target.label.trim() }))
    .filter((target) => target.id && target.label)
)

const filteredMentionTargets = computed(() => {
  const trigger = mentionTrigger.value
  if (!trigger) return []
  const query = trigger.query.trim().toLocaleLowerCase()
  const targets = normalizedMentionTargets.value
  if (!query) return targets.slice(0, 8)

  return targets
    .filter((target) =>
      [target.label, target.name, target.description].some((value) =>
        value?.toLocaleLowerCase().includes(query)
      )
    )
    .slice(0, 8)
})

const mentionOpen = computed(() => filteredMentionTargets.value.length > 0)
const canSend = computed(() => text.value.trim().length > 0 || files.value.length > 0)

watch(
  () => props.replyTo,
  (v) => {
    if (v) inputRef.value?.focus()
  }
)

watch(filteredMentionTargets, (targets) => {
  if (highlightedMentionIndex.value >= targets.length) {
    highlightedMentionIndex.value = Math.max(0, targets.length - 1)
  }
})

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) closeMentionPicker()
  }
)

function submit(): void {
  if (props.disabled || isComposing.value) return
  const rawText = text.value
  const trimmed = rawText.trim()
  if (!trimmed && files.value.length === 0) return
  const mentions = extractMentionIds(rawText)
  emit('send', {
    text: trimmed || DEFAULT_ATTACHMENT_ONLY_TEXT,
    replyTo: props.replyTo ?? undefined,
    ...(mentions.length ? { mentions } : {}),
    ...(files.value.length ? { files: [...files.value] } : {})
  })
  text.value = ''
  files.value = []
  attachmentError.value = null
  closeMentionPicker()
}

function isComposingEvent(event: KeyboardEvent): boolean {
  return isComposing.value || event.isComposing || event.key === 'Process' || event.keyCode === 229
}

function onKey(event: KeyboardEvent): void {
  if (mentionOpen.value && !isComposingEvent(event)) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      highlightedMentionIndex.value =
        (highlightedMentionIndex.value + 1) % filteredMentionTargets.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      highlightedMentionIndex.value =
        (highlightedMentionIndex.value - 1 + filteredMentionTargets.value.length) %
        filteredMentionTargets.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const target = filteredMentionTargets.value[highlightedMentionIndex.value]
      if (target) insertMention(target, true)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMentionPicker()
      return
    }
  }

  if (event.key === 'Enter' && event.shiftKey) return

  if (event.key === 'Enter') {
    if (isComposingEvent(event)) return
    event.preventDefault()
    submit()
  } else if (event.key === 'Escape' && props.replyTo) {
    event.preventDefault()
    emit('cancel-reply')
  }
}

function onInput(): void {
  updateMentionTrigger()
}

function onCursorChange(): void {
  updateMentionTrigger()
}

function onCursorKeyup(event: KeyboardEvent): void {
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
  updateMentionTrigger()
}

function onCompositionEnd(): void {
  isComposing.value = false
  updateMentionTrigger()
}

function updateMentionTrigger(): void {
  if (props.disabled || isComposing.value || normalizedMentionTargets.value.length === 0) {
    closeMentionPicker()
    return
  }

  const input = inputRef.value
  if (!input || input.selectionStart !== input.selectionEnd) {
    closeMentionPicker()
    return
  }

  const cursor = input.selectionStart
  const beforeCursor = text.value.slice(0, cursor)
  const match = beforeCursor.match(/(^|[\s([{（，。！？、；：,.!?;:])@([^\s@]*)$/u)
  if (!match) {
    closeMentionPicker()
    return
  }

  mentionTrigger.value = {
    start: cursor - (match[2]?.length ?? 0) - 1,
    query: match[2] ?? ''
  }
  highlightedMentionIndex.value = 0
}

function closeMentionPicker(): void {
  mentionTrigger.value = null
  highlightedMentionIndex.value = 0
}

function insertMention(target: MentionTarget, replaceTrigger: boolean): void {
  const input = inputRef.value
  const current = text.value
  const activeInput = document.activeElement === input
  const cursorStart = input && activeInput ? input.selectionStart : current.length
  const cursorEnd = input && activeInput ? input.selectionEnd : current.length
  const start = replaceTrigger && mentionTrigger.value ? mentionTrigger.value.start : cursorStart
  const end = replaceTrigger && mentionTrigger.value ? cursorStart : cursorEnd
  const before = current.slice(0, start)
  const after = current.slice(end)
  const prefix = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const token = `${prefix}@${target.label} `
  text.value = `${before}${token}${after}`
  closeMentionPicker()

  void nextTick(() => {
    inputRef.value?.focus()
    const cursor = before.length + token.length
    inputRef.value?.setSelectionRange(cursor, cursor)
  })
}

function insertMentionById(id: string): void {
  const target = normalizedMentionTargets.value.find((item) => item.id === id)
  if (!target || props.disabled) return
  insertMention(target, false)
}

function openFilePicker(): void {
  if (props.disabled || !props.attachmentsEnabled) return
  fileInputRef.value?.click()
}

function onFileInput(event: Event): void {
  const input = event.target as HTMLInputElement
  addFiles(input.files)
  input.value = ''
}

function addFiles(fileList: FileList | File[] | null): void {
  if (!props.attachmentsEnabled || props.disabled || !fileList) return
  attachmentError.value = null
  const next = [...files.value]
  for (const file of Array.from(fileList)) {
    if (next.length >= MAX_ATTACHMENTS) {
      attachmentError.value = `最多上传 ${MAX_ATTACHMENTS} 个文件`
      break
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      attachmentError.value = `单个文件不能超过 ${formatBytes(MAX_ATTACHMENT_BYTES)}`
      continue
    }
    const duplicate = next.some(
      (item) =>
        item.name === file.name &&
        item.size === file.size &&
        item.lastModified === file.lastModified
    )
    if (!duplicate) next.push(file)
  }
  files.value = next
}

function removeFile(index: number): void {
  files.value = files.value.filter((_, i) => i !== index)
  if (files.value.length < MAX_ATTACHMENTS) attachmentError.value = null
}

function onDragOver(event: DragEvent): void {
  if (!props.attachmentsEnabled || props.disabled) return
  event.preventDefault()
  dragActive.value = true
}

function onDragLeave(event: DragEvent): void {
  if ((event.currentTarget as HTMLElement)?.contains(event.relatedTarget as Node | null)) return
  dragActive.value = false
}

function onDrop(event: DragEvent): void {
  if (!props.attachmentsEnabled || props.disabled) return
  event.preventDefault()
  dragActive.value = false
  addFiles(event.dataTransfer?.files ?? null)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractMentionIds(value: string): string[] {
  const ids = new Set<string>()
  for (const target of normalizedMentionTargets.value) {
    const pattern = new RegExp(
      `(^|[\\s([{（，。！？、；：,.!?;:])@${escapeRegExp(target.label)}(?= )`,
      'u'
    )
    if (pattern.test(value)) ids.add(target.id)
  }
  return [...ids]
}

defineExpose({ insertMentionById })
</script>

<template>
  <div
    class="p-4 border-t border-surface-border bg-surface flex-shrink-0"
    :class="dragActive ? 'bg-primary-soft/60' : ''"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div class="flex flex-col">
      <div
        v-if="replyTo"
        class="mb-2 flex items-start justify-between bg-background border-l-2 border-primary rounded px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-text-main">回复 {{ replyTo.senderName }}</div>
          <div class="text-sm text-text-muted line-clamp-2 break-words">
            {{ replyTo.excerpt }}
          </div>
        </div>
        <button
          type="button"
          class="ml-2 text-text-muted hover:text-text-main p-0.5 rounded-sm hover:bg-gray-150 transition-colors"
          @click="emit('cancel-reply')"
        >
          <span class="material-symbols-outlined text-2xl">close</span>
        </button>
      </div>
      <div v-if="files.length || attachmentError" class="mb-2 flex flex-wrap gap-2">
        <div
          v-for="(file, index) in files"
          :key="`${file.name}-${file.size}-${file.lastModified}`"
          class="flex max-w-[260px] items-center gap-2 rounded border border-surface-border bg-background px-2.5 py-1.5 text-sm text-text-main"
        >
          <span class="material-symbols-outlined text-xl text-primary">attach_file</span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium">{{ file.name }}</span>
            <span class="block text-xs text-text-muted">{{ formatBytes(file.size) }}</span>
          </span>
          <button
            type="button"
            class="rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-main"
            title="移除附件"
            @click="removeFile(index)"
          >
            <span class="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        <div
          v-if="attachmentError"
          class="flex items-center rounded border border-danger/30 bg-danger/5 px-2.5 py-1.5 text-sm text-danger"
        >
          {{ attachmentError }}
        </div>
      </div>
      <div class="relative p-1">
        <Transition name="pop">
          <div
            v-if="mentionOpen"
            class="absolute bottom-full left-0 z-40 mb-2 max-h-56 w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-surface-border bg-white py-1 shadow-lg"
          >
            <button
              v-for="(target, index) in filteredMentionTargets"
              :key="target.id"
              type="button"
              class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
              :class="
                index === highlightedMentionIndex ? 'bg-primary-soft' : 'hover:bg-surface-hover'
              "
              @mousedown.prevent="insertMention(target, true)"
            >
              <AgentAvatar
                :name="target.label"
                :avatar="target.avatar"
                :color="target.color"
                size="sm"
              />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-base font-medium text-text-main">
                  @{{ target.label }}
                </span>
                <span
                  v-if="target.name || target.description"
                  class="block truncate text-xs text-text-muted"
                >
                  {{ [target.name, target.description].filter(Boolean).join(' · ') }}
                </span>
              </span>
            </button>
          </div>
        </Transition>
        <textarea
          ref="inputRef"
          v-model="text"
          :disabled="disabled"
          :class="[
            'w-full h-[72px] p-0 resize-none border-none focus:ring-0 focus:outline-none text-md text-text-main bg-transparent leading-[22px]',
            disabledReason ? 'placeholder:text-text-main' : 'placeholder-text-muted'
          ]"
          :placeholder="disabledReason ?? 'Type a message or /command...'"
          @compositionstart="isComposing = true"
          @compositionend="onCompositionEnd"
          @input="onInput"
          @click="onCursorChange"
          @keyup="onCursorKeyup"
          @keydown="onKey"
        />
      </div>
      <div class="flex items-center justify-between py-2">
        <div class="flex items-center space-x-2 text-text-muted">
          <input ref="fileInputRef" type="file" class="hidden" multiple @change="onFileInput" />
          <BaseButton
            variant="ghost"
            icon
            title="上传文件"
            :disabled="disabled || !attachmentsEnabled"
            @click="openFilePicker"
          >
            <span class="material-symbols-outlined text-3xl">attach_file</span>
          </BaseButton>
          <BaseButton variant="ghost" icon>
            <span class="material-symbols-outlined text-3xl">code</span>
          </BaseButton>
        </div>
        <button
          v-if="streaming"
          class="bg-surface text-text-main border border-surface-border px-5 py-1.5 rounded text-base font-medium flex items-center space-x-1.5 hover:bg-gray-150 transition-colors"
          @click="emit('stop')"
        >
          <span>停止&nbsp;</span>
          <span class="material-symbols-outlined text-xl">stop_circle</span>
        </button>
        <button
          v-else
          class="bg-primary text-white px-5 py-1.5 rounded text-base font-medium flex items-center space-x-1.5 hover:bg-primary-hover transition-colors disabled:opacity-50"
          :disabled="disabled || isComposing || !canSend"
          @click="submit"
        >
          <span>发送&nbsp;</span>
          <span class="material-symbols-outlined text-xl">send</span>
        </button>
      </div>
    </div>
  </div>
</template>
