<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ApiError } from '../api'
import { login, register } from '../stores/auth'

type Mode = 'login' | 'register'

const mode = ref<Mode>('login')
const form = reactive({ account: '', password: '', confirm: '' })
const error = ref<string | null>(null)
const submitting = ref(false)

function switchMode(next: Mode): void {
  if (mode.value === next) return
  mode.value = next
  error.value = null
}

function validate(): string | null {
  if (!form.account.trim()) return '请输入账号'
  if (!form.password) return '请输入密码'
  if (mode.value === 'register') {
    if (form.account.trim().length < 4) return '账号至少 4 位'
    if (!/^[a-zA-Z0-9_-]+$/.test(form.account.trim()))
      return '账号只能包含字母、数字、下划线或连字符'
    if (form.password.length < 6) return '密码至少 6 位'
    if (form.password !== form.confirm) return '两次输入的密码不一致'
  }
  return null
}

async function onSubmit(): Promise<void> {
  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }
  error.value = null
  submitting.value = true
  try {
    const payload = { account: form.account.trim(), password: form.password }
    if (mode.value === 'login') await login(payload)
    else await register(payload)
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : '操作失败，请重试'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="w-full h-full flex items-center justify-center bg-background">
    <div class="w-[380px] bg-surface rounded-[12px] shadow-card border border-surface-border p-8">
      <div class="flex flex-col items-center mb-6">
        <div
          class="w-12 h-12 rounded-[12px] bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white mb-3"
        >
          <span class="material-symbols-outlined text-[26px]">hub</span>
        </div>
        <h1 class="text-[18px] font-semibold text-text-main">AgentHub</h1>
        <p class="text-[12px] text-text-muted mt-1">
          {{ mode === 'login' ? '登录以继续' : '创建你的账号' }}
        </p>
      </div>

      <div class="flex bg-surface-hover rounded-[8px] p-1 mb-5">
        <button
          type="button"
          class="flex-1 h-8 rounded-[6px] text-[13px] font-medium transition-colors"
          :class="mode === 'login' ? 'bg-surface text-primary shadow-tab' : 'text-text-muted'"
          @click="switchMode('login')"
        >
          登录
        </button>
        <button
          type="button"
          class="flex-1 h-8 rounded-[6px] text-[13px] font-medium transition-colors"
          :class="mode === 'register' ? 'bg-surface text-primary shadow-tab' : 'text-text-muted'"
          @click="switchMode('register')"
        >
          注册
        </button>
      </div>

      <form class="space-y-3.5" @submit.prevent="onSubmit">
        <div>
          <label class="block text-[12px] text-text-muted mb-1.5">账号</label>
          <input
            v-model="form.account"
            type="text"
            autocomplete="username"
            placeholder="字母、数字、下划线或连字符"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
        </div>
        <div>
          <label class="block text-[12px] text-text-muted mb-1.5">密码</label>
          <input
            v-model="form.password"
            type="password"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="请输入密码"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
        </div>
        <div v-if="mode === 'register'">
          <label class="block text-[12px] text-text-muted mb-1.5">确认密码</label>
          <input
            v-model="form.confirm"
            type="password"
            autocomplete="new-password"
            placeholder="请再次输入密码"
            class="w-full h-10 px-3 rounded-[8px] border border-surface-border bg-surface text-[13px] text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition"
          />
        </div>

        <p v-if="error" class="text-[12px] text-danger">{{ error }}</p>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full h-10 rounded-[8px] bg-primary hover:bg-primary-hover text-white text-[13px] font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {{ submitting ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录' }}
        </button>
      </form>
    </div>
  </div>
</template>
