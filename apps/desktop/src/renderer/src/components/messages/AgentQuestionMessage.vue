<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { AgentQuestion, AgentQuestionMessage, AgentQuestionOption } from '../../api'
import { formatTime } from '../../utils/format'
import BaseButton from '../ui/BaseButton.vue'
import BaseInput from '../ui/BaseInput.vue'
import SenderAvatar from './SenderAvatar.vue'

const props = defineProps<{ message: AgentQuestionMessage }>()

const emit = defineEmits<{
  (e: 'submit', payload: { message: AgentQuestionMessage; text: string; mentions: string[] }): void
}>()

interface Draft {
  opts: string[]
  text: string
}

// 每题的作答草稿：选中的 option id 列表 + 自由补充文本。
const answers = reactive<Record<string, Draft>>(
  Object.fromEntries(props.message.questions.map((q) => [q.id, { opts: [], text: '' }]))
)

function allowsText(q: AgentQuestion): boolean {
  return q.allowText === true || q.options.length === 0
}

function isSelected(q: AgentQuestion, opt: AgentQuestionOption): boolean {
  return answers[q.id]?.opts.includes(opt.id) ?? false
}

function toggle(q: AgentQuestion, opt: AgentQuestionOption): void {
  if (props.message.answered) return
  const draft = answers[q.id]
  if (!draft) return
  if (q.multiSelect) {
    const i = draft.opts.indexOf(opt.id)
    if (i >= 0) draft.opts.splice(i, 1)
    else draft.opts.push(opt.id)
  } else {
    draft.opts = draft.opts[0] === opt.id ? [] : [opt.id]
  }
}

function questionAnswered(q: AgentQuestion): boolean {
  const draft = answers[q.id]
  if (!draft) return false
  return draft.opts.length > 0 || draft.text.trim().length > 0
}

const canSubmit = computed(
  () => !props.message.answered && props.message.questions.every(questionAnswered)
)

/** 把各题作答拼成一句可读中文回复。 */
function compose(): string {
  const lines: string[] = []
  for (const q of props.message.questions) {
    const draft = answers[q.id]
    if (!draft) continue
    const labels = q.options.filter((o) => draft.opts.includes(o.id)).map((o) => o.label)
    const extra = draft.text.trim()
    const parts = [...labels]
    if (extra) parts.push(extra)
    lines.push(`${q.header || q.question}：${parts.join('、')}`)
  }
  return lines.join('\n')
}

function submit(): void {
  if (!canSubmit.value) return
  const text = compose()
  if (!text) return
  emit('submit', { message: props.message, text, mentions: [props.message.sender.id] })
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
        class="bg-surface border border-surface-border p-4 rounded-xl rounded-tl-sm text-md w-full max-w-lg shadow-sm"
      >
        <p v-if="message.summary" class="text-text-main mb-3 leading-[22px]">
          {{ message.summary }}
        </p>

        <!-- 已作答：只读展示用户回复 -->
        <div
          v-if="message.answered"
          class="rounded-lg bg-primary-soft border border-primary/20 px-3 py-2"
        >
          <div class="flex items-center gap-1.5 text-sm text-primary mb-1">
            <span class="material-symbols-outlined text-lg">done</span>
            <span>你的回复</span>
          </div>
          <p class="text-base text-text-main whitespace-pre-wrap break-words">
            {{ message.answerText }}
          </p>
        </div>

        <!-- 待作答：逐题表单 -->
        <template v-else>
          <div
            v-for="q in message.questions"
            :key="q.id"
            class="mb-4 last:mb-0"
          >
            <div class="flex items-baseline gap-2 mb-2">
              <span
                v-if="q.header"
                class="text-xs font-semibold text-primary bg-primary-soft px-1.5 py-0.5 rounded"
                >{{ q.header }}</span
              >
              <span class="text-base font-medium text-text-main">{{ q.question }}</span>
              <span v-if="q.multiSelect" class="text-xs text-text-muted">（可多选）</span>
            </div>
            <ul v-if="q.options.length" class="space-y-1.5 mb-2">
              <li v-for="opt in q.options" :key="opt.id">
                <button
                  type="button"
                  :class="[
                    'w-full flex items-start gap-2.5 px-3 py-2 rounded text-left transition-colors',
                    isSelected(q, opt)
                      ? 'bg-primary-soft border border-primary/40'
                      : 'bg-background border border-transparent hover:bg-primary-soft active:bg-primary-softer'
                  ]"
                  @click="toggle(q, opt)"
                >
                  <span
                    class="material-symbols-outlined text-xl mt-0.5"
                    :class="isSelected(q, opt) ? 'text-primary' : 'text-text-muted'"
                  >
                    {{
                      q.multiSelect
                        ? isSelected(q, opt)
                          ? 'check_box'
                          : 'check_box_outline_blank'
                        : isSelected(q, opt)
                          ? 'radio_button_checked'
                          : 'radio_button_unchecked'
                    }}
                  </span>
                  <span class="flex-1">
                    <span class="block text-base text-text-main">{{ opt.label }}</span>
                    <span v-if="opt.description" class="block text-sm text-text-muted">{{
                      opt.description
                    }}</span>
                  </span>
                </button>
              </li>
            </ul>
            <BaseInput
              v-if="allowsText(q)"
              v-model="answers[q.id].text"
              type="text"
              :placeholder="q.options.length ? '其它/补充（可选）' : '在此输入你的回答…'"
            />
          </div>

          <BaseButton
            variant="primary"
            block
            :disabled="!canSubmit"
            class="mt-1"
            @click="submit"
          >
            <span class="material-symbols-outlined text-xl">send</span>
            提交回复
          </BaseButton>
        </template>
      </div>
    </div>
  </div>
</template>
