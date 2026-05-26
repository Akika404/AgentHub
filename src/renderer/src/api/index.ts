import { mockApi } from './mock'
import type { AgentHubApi } from './types'

/**
 * Single entry point for renderer code to access the backend.
 * Currently wired to the local Mock service; can be swapped for a real
 * fetch/IPC-backed implementation without touching consumers.
 */
export const api: AgentHubApi = mockApi

export type * from './types'
