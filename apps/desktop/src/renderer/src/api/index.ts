import { mockApi } from './mock'
import type { AgentHubApi } from '@agenthub/shared'

/**
 * The chat experience is still served by the local Mock service (the backend
 * chat module isn't ready yet). The auth / agents / providers modules talk to
 * the real backend through the typed clients below, which funnel every request
 * through the main-process HTTP proxy (`window.api.request`).
 */
export const api: AgentHubApi = mockApi

export { authApi } from './auth'
export { agentApi, agentChatApi } from './agents'
export { groupChatApi } from './group-chats'
export { providerApi } from './providers'
export { ApiError } from './http'

export type * from '@agenthub/shared'
