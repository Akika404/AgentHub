import {
  ERROR_CODE,
  SUCCESS_CODE,
  type AgentChatView,
  type AgentChatMessageView,
  type AgentEvent,
  type AgentView,
  type ApiResponse,
  type CreateAgentChatPayload,
  type CreateAgentPayload,
  type MessageReplyRef,
  type StartTurnResult,
  type UpdateAgentChatPayload,
  type UpdateAgentChatMessagePayload,
  type UpdateAgentPayload,
  type WorkspaceCommitPayload,
  type WorkspaceCommitResult,
  type WorkspaceDiffSummary,
  type BlackboardArtifactPreview
} from '@agenthub/shared'
import { getToken, onUnauthorized } from '../stores/auth'
import { ApiError, http } from './http'

interface StreamPayload<T> {
  streamId: string
  data: T
}

interface StreamErrorPayload {
  streamId: string
  error: string
}

export interface AgentConverseHandlers {
  onEvent(event: AgentEvent): void
  onError?(message: string): void
  onDone?(): void
}

export interface AgentConverseStream {
  streamId: string
  /** The turn being watched. Aborting this turn stops it server-side for all devices. */
  turnId: string
  /** Resolves once the SSE subscription is established (or rejects if it fails). */
  started: Promise<void>
  /** Detach this client from the turn. Does NOT stop the turn server-side. */
  cancel(): Promise<void>
}

function nextStreamId(): string {
  return `agent-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function hasStreamId(payload: unknown, streamId: string): payload is { streamId: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'streamId' in payload &&
    (payload as { streamId?: unknown }).streamId === streamId
  )
}

function isStreamPayload<T>(payload: unknown, streamId: string): payload is StreamPayload<T> {
  return hasStreamId(payload, streamId) && 'data' in payload
}

function cleanup(unsubscribers: Array<() => void>): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers.length = 0
}

/**
 * Subscribe to a turn's event stream (replay + live tail). The turn runs
 * server-side independently of this subscription: cancelling only detaches this
 * client, it does not stop the turn. Works for both the device that started the
 * turn and any other device watching the same turn.
 */
function subscribeTurn(
  chatId: string,
  turnId: string,
  handlers: AgentConverseHandlers
): AgentConverseStream {
  const streamId = nextStreamId()
  const path = `/agent-chats/${chatId}/turns/${turnId}/events`
  const unsubscribers: Array<() => void> = []

  const cancel = async (): Promise<void> => {
    cleanup(unsubscribers)
    await window.api.streamCancel(streamId)
  }

  unsubscribers.push(
    window.api.onStream('event', (payload) => {
      if (!isStreamPayload<AgentEvent>(payload, streamId)) return
      handlers.onEvent(payload.data)
    }),
    window.api.onStream('error', (payload) => {
      if (!hasStreamId(payload, streamId)) return
      handlers.onError?.((payload as StreamErrorPayload).error)
    }),
    window.api.onStream('done', (payload) => {
      if (!hasStreamId(payload, streamId)) return
      cleanup(unsubscribers)
      handlers.onDone?.()
    })
  )

  const started = window.api
    .streamStart({
      streamId,
      path,
      token: getToken() ?? undefined
    })
    .then((res) => {
      if (res.status === 0) {
        cleanup(unsubscribers)
        throw new ApiError(-1, res.error ?? '无法连接到服务器，请确认后端已启动')
      }

      if (!res.ok) {
        cleanup(unsubscribers)
        const envelope = res.body as ApiResponse<null> | null
        if (envelope?.code === ERROR_CODE.UNAUTHORIZED) onUnauthorized()
        throw new ApiError(
          envelope?.code ?? res.status,
          envelope?.message ?? `请求失败（HTTP ${res.status}）`
        )
      }

      const envelope = res.body as ApiResponse<null> | null
      if (envelope && envelope.code !== SUCCESS_CODE) {
        cleanup(unsubscribers)
        if (envelope.code === ERROR_CODE.UNAUTHORIZED) onUnauthorized()
        throw new ApiError(envelope.code, envelope.message || `请求失败（code ${envelope.code}）`)
      }
    })

  return { streamId, turnId, started, cancel }
}

/**
 * Start a turn then immediately subscribe to its events. Returns once the turn
 * is started (turnId known) and the subscription is wired; `started` resolves
 * when the SSE connection is live.
 */
async function startConverseStream(
  chatId: string,
  prompt: string,
  handlers: AgentConverseHandlers,
  replyTo?: MessageReplyRef
): Promise<AgentConverseStream> {
  const { turnId } = await http.post<StartTurnResult>(`/agent-chats/${chatId}/converse`, {
    prompt,
    ...(replyTo ? { replyTo } : {})
  })
  return subscribeTurn(chatId, turnId, handlers)
}

async function startRegenerateStream(
  chatId: string,
  messageId: string,
  handlers: AgentConverseHandlers
): Promise<AgentConverseStream> {
  const { turnId } = await http.post<StartTurnResult>(
    `/agent-chats/${chatId}/messages/${messageId}/regenerate`
  )
  return subscribeTurn(chatId, turnId, handlers)
}

/** Multi-agent module client. Maps `/api/agents/*`. */
export const agentApi = {
  list: () => http.get<AgentView[]>('/agents'),
  get: (agentId: string) => http.get<AgentView>(`/agents/${agentId}`),
  create: (payload: CreateAgentPayload) => http.post<AgentView>('/agents', payload),
  update: (agentId: string, payload: UpdateAgentPayload) =>
    http.patch<AgentView>(`/agents/${agentId}`, payload),
  delete: (agentId: string) => http.delete<{ deleted: true }>(`/agents/${agentId}`)
}

/** Single-Agent chat client. Maps `/api/agent-chats/*`. */
export const agentChatApi = {
  list: () => http.get<AgentChatView[]>('/agent-chats'),
  get: (chatId: string) => http.get<AgentChatView>(`/agent-chats/${chatId}`),
  create: (payload: CreateAgentChatPayload) => http.post<AgentChatView>('/agent-chats', payload),
  update: (chatId: string, payload: UpdateAgentChatPayload) =>
    http.patch<AgentChatView>(`/agent-chats/${chatId}`, payload),
  listMessages: (chatId: string) =>
    http.get<AgentChatMessageView[]>(`/agent-chats/${chatId}/messages`),
  updateMessage: (chatId: string, messageId: string, payload: UpdateAgentChatMessagePayload) =>
    http.patch<AgentChatMessageView>(`/agent-chats/${chatId}/messages/${messageId}`, payload),
  getWorkspaceDiff: (chatId: string) =>
    http.get<WorkspaceDiffSummary>(`/agent-chats/${chatId}/workspace-diff`),
  commitWorkspace: (chatId: string, payload?: WorkspaceCommitPayload) =>
    http.post<WorkspaceCommitResult>(`/agent-chats/${chatId}/workspace-commit`, payload ?? {}),
  /** Preview a workspace artifact file by workspace-relative path (single-chat). */
  getArtifactPreview: (chatId: string, path: string) =>
    http.get<BlackboardArtifactPreview>(
      `/agent-chats/${chatId}/artifacts/preview?path=${encodeURIComponent(path)}`
    ),
  clear: (chatId: string) => http.post<AgentChatView>(`/agent-chats/${chatId}/clear`),
  delete: (chatId: string) => http.delete<{ deleted: true }>(`/agent-chats/${chatId}`),
  /** Start a turn (runs server-side, detached) and subscribe to its event stream. */
  converse: startConverseStream,
  /** Start a regenerate turn from an existing message and subscribe to its event stream. */
  regenerate: startRegenerateStream,
  /** Subscribe to an already-running turn's stream (replay + tail) — used to watch live progress. */
  subscribeTurn,
  /** Stop a running turn server-side (affects every watching device). */
  abortTurn: (chatId: string, turnId: string) =>
    http.post<{ aborted: true }>(`/agent-chats/${chatId}/turns/${turnId}/abort`)
}
