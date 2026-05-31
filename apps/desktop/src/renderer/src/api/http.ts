import { ERROR_CODE, SUCCESS_CODE, type ApiResponse } from '@agenthub/shared'
import { getToken, onUnauthorized } from '../stores/auth'

/** Error carrying the backend business code + message. */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/**
 * Issue a request through the main-process proxy and unwrap the unified
 * envelope. Returns `data` on success; throws `ApiError` otherwise.
 * A `2001 UNAUTHORIZED` business code clears the session (forces re-login).
 */
export async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const res = await window.api.request({ method, path, body, token: getToken() ?? undefined })

  if (res.status === 0) {
    throw new ApiError(-1, res.error ?? '无法连接到服务器，请确认后端已启动')
  }

  const envelope = res.body as ApiResponse<T> | null
  if (!envelope || typeof envelope.code !== 'number') {
    throw new ApiError(res.status, `请求失败（HTTP ${res.status}）`)
  }

  if (envelope.code === SUCCESS_CODE) {
    return envelope.data as T
  }

  if (envelope.code === ERROR_CODE.UNAUTHORIZED) {
    onUnauthorized()
  }
  throw new ApiError(envelope.code, envelope.message || `请求失败（code ${envelope.code}）`)
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body)
}
