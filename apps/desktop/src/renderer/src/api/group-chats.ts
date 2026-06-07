import {
  ERROR_CODE,
  SUCCESS_CODE,
  type ApiResponse,
  type BlackboardArtifactPreview,
  type BlackboardEventView,
  type BlackboardView,
  type ConverseGroupPayload,
  type CreateGroupChatPayload,
  type GroupChatView,
  type GroupMessageView,
  type GroupRunEvent,
  type StartGroupRunResult,
  type UpdateGroupChatPayload
} from '@agenthub/shared'
import { getToken, onUnauthorized } from '../stores/auth'
import { ApiError, http } from './http'

export interface GroupRunHandlers {
  onEvent(event: GroupRunEvent): void
  onError?(message: string): void
  onDone?(): void
}

export interface GroupRunStream {
  streamId: string
  runId: string
  /** Resolves once the SSE subscription is established (or rejects if it fails). */
  started: Promise<void>
  /** Detach this client from the run. Does NOT stop the run server-side. */
  cancel(): Promise<void>
}

function nextStreamId(): string {
  return `group-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function hasStreamId(payload: unknown, streamId: string): payload is { streamId: string } {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'streamId' in payload &&
    (payload as { streamId?: unknown }).streamId === streamId
  )
}

function isStreamPayload(
  payload: unknown,
  streamId: string
): payload is { streamId: string; data: GroupRunEvent } {
  return hasStreamId(payload, streamId) && 'data' in payload
}

function cleanup(unsubscribers: Array<() => void>): void {
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers.length = 0
}

/**
 * Subscribe to a group run's event stream (replay + live tail). The run executes
 * server-side independently of this subscription; cancelling only detaches this
 * client. Mirrors the single-chat turn subscription.
 */
function subscribeRun(groupId: string, runId: string, handlers: GroupRunHandlers): GroupRunStream {
  const streamId = nextStreamId()
  const path = `/group-chats/${groupId}/runs/${runId}/events`
  const unsubscribers: Array<() => void> = []

  const cancel = async (): Promise<void> => {
    cleanup(unsubscribers)
    await window.api.streamCancel(streamId)
  }

  unsubscribers.push(
    window.api.onStream('event', (payload) => {
      if (!isStreamPayload(payload, streamId)) return
      handlers.onEvent(payload.data)
    }),
    window.api.onStream('error', (payload) => {
      if (!hasStreamId(payload, streamId)) return
      handlers.onError?.((payload as { streamId: string; error: string }).error)
    }),
    window.api.onStream('done', (payload) => {
      if (!hasStreamId(payload, streamId)) return
      cleanup(unsubscribers)
      handlers.onDone?.()
    })
  )

  const started = window.api
    .streamStart({ streamId, path, token: getToken() ?? undefined })
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

  return { streamId, runId, started, cancel }
}

/** Start a group run then subscribe to its event stream. */
async function converseStream(
  groupId: string,
  payload: ConverseGroupPayload,
  handlers: GroupRunHandlers
): Promise<GroupRunStream> {
  const { runId } = await http.post<StartGroupRunResult>(
    `/group-chats/${groupId}/converse`,
    payload
  )
  return subscribeRun(groupId, runId, handlers)
}

/** Group chat collaboration client. Maps `/api/group-chats/*`. */
export const groupChatApi = {
  list: () => http.get<GroupChatView[]>('/group-chats'),
  get: (id: string) => http.get<GroupChatView>(`/group-chats/${id}`),
  create: (payload: CreateGroupChatPayload) => http.post<GroupChatView>('/group-chats', payload),
  update: (id: string, payload: UpdateGroupChatPayload) =>
    http.patch<GroupChatView>(`/group-chats/${id}`, payload),
  delete: (id: string) => http.delete<{ deleted: true }>(`/group-chats/${id}`),
  listMessages: (id: string) => http.get<GroupMessageView[]>(`/group-chats/${id}/messages`),
  /** Start a group run (detached) and subscribe to its event stream. */
  converse: converseStream,
  /** Subscribe to an already-running run's stream (replay + tail). */
  subscribeRun,
  abortRun: (id: string, runId: string) =>
    http.post<{ aborted: true }>(`/group-chats/${id}/runs/${runId}/abort`),
  getBlackboard: (id: string) => http.get<BlackboardView>(`/group-chats/${id}/blackboard`),
  getArtifactPreview: (id: string, artifactId: string) =>
    http.get<BlackboardArtifactPreview>(
      `/group-chats/${id}/blackboard/artifacts/${artifactId}/preview`
    ),
  getBlackboardEvents: (id: string) =>
    http.get<BlackboardEventView[]>(`/group-chats/${id}/blackboard/events`)
}
