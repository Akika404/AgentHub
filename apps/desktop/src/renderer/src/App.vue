<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { authState, initAuth, isAuthenticated } from './stores/auth'
import GlobalSidebar from './components/GlobalSidebar.vue'
import AuthView from './views/AuthView.vue'
import ChatView from './views/ChatView.vue'
import GroupChatView from './views/GroupChatView.vue'
import AgentsView from './views/AgentsView.vue'
import SettingsView from './views/SettingsView.vue'

type NavKey = 'chat' | 'groups' | 'agents' | 'settings'

const nav = ref<NavKey>('chat')

onMounted(initAuth)
</script>

<template>
  <div class="flex w-full h-full bg-background">
    <template v-if="!authState.ready">
      <div class="flex-1 flex items-center justify-center text-text-muted text-base">正在加载…</div>
    </template>

    <AuthView v-else-if="!isAuthenticated()" />

    <template v-else>
      <GlobalSidebar :active="nav" :user="authState.user" @navigate="nav = $event" />
      <ChatView v-show="nav === 'chat'" />
      <GroupChatView v-show="nav === 'groups'" />
      <AgentsView v-show="nav === 'agents'" />
      <SettingsView v-show="nav === 'settings'" />
    </template>
  </div>
</template>
