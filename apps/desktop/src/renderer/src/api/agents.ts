import type { AgentView, CreateAgentPayload } from '@agenthub/shared'
import { http } from './http'

/** Multi-agent module client. Maps `/api/agents/*` (REST subset; no SSE). */
export const agentApi = {
  list: () => http.get<AgentView[]>('/agents'),
  get: (agentId: string) => http.get<AgentView>(`/agents/${agentId}`),
  create: (payload: CreateAgentPayload) => http.post<AgentView>('/agents', payload),
  delete: (agentId: string) => http.delete<{ deleted: true }>(`/agents/${agentId}`)
}
