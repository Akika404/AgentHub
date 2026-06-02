import { ipcMain, type IpcMainInvokeEvent } from 'electron'

/**
 * Main-process HTTP proxy.
 *
 * The renderer is a Chromium context subject to CORS, and the backend doesn't
 * send CORS headers, so the renderer can't `fetch` it directly. Instead all
 * backend REST calls funnel through a single `api:request` IPC channel handled
 * here with Node's global `fetch` (no origin, no CORS). This keeps the IPC
 * surface minimal (one channel) per the project's IPC convention.
 */

const BASE_URL = process.env['AGENTHUB_API_BASE'] ?? 'http://localhost:3000/api'

export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** path relative to the API base, e.g. `/user/login` */
  path: string
  /** JSON body for non-GET requests */
  body?: unknown
  /** bearer token for protected routes */
  token?: string
}

export interface ApiProxyResponse {
  /** HTTP status; 0 when the request never reached the server */
  status: number
  ok: boolean
  /** parsed JSON body, or null when there's no/invalid body */
  body: unknown
  /** transport-level error message (network down, DNS, timeout) */
  error?: string
}

export interface ApiStreamRequest {
  /** renderer-generated id used to correlate stream events */
  streamId: string
  /** GET path relative to the API base, e.g. `/agent-chats/:id/converse?prompt=...` */
  path: string
  /** bearer token for protected routes */
  token?: string
}

const activeStreams = new Map<string, AbortController>()

async function handleRequest(req: ApiRequest): Promise<ApiProxyResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (req.token) headers['Authorization'] = `Bearer ${req.token}`

  try {
    const response = await fetch(`${BASE_URL}${req.path}`, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.body === undefined ? undefined : JSON.stringify(req.body)
    })

    let body: unknown = null
    const text = await response.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }

    return { status: response.status, ok: response.ok, body }
  } catch (err) {
    return {
      status: 0,
      ok: false,
      body: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function parseResponseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function emitSseBlock(event: IpcMainInvokeEvent, streamId: string, block: string): void {
  const dataLines = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length === 0) return
  const data = dataLines.join('\n')
  if (!data || data === '[DONE]') return

  let payload: unknown = data
  try {
    payload = JSON.parse(data)
  } catch {
    /* tolerate non-JSON SSE payloads */
  }

  event.sender.send('api:stream:event', { streamId, data: payload })
}

async function pumpSse(
  event: IpcMainInvokeEvent,
  streamId: string,
  response: Response,
  abort: AbortController
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    event.sender.send('api:stream:error', { streamId, error: 'SSE response has no body' })
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 2)
        if (block) emitSseBlock(event, streamId, block)
        boundary = buffer.indexOf('\n\n')
      }
    }

    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail) emitSseBlock(event, streamId, tail)
  } catch (err) {
    if (!abort.signal.aborted) {
      event.sender.send('api:stream:error', {
        streamId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  } finally {
    activeStreams.delete(streamId)
    event.sender.send('api:stream:done', { streamId })
  }
}

async function handleStreamStart(
  event: IpcMainInvokeEvent,
  req: ApiStreamRequest
): Promise<ApiProxyResponse> {
  activeStreams.get(req.streamId)?.abort()

  const abort = new AbortController()
  activeStreams.set(req.streamId, abort)

  const headers: Record<string, string> = { Accept: 'text/event-stream' }
  if (req.token) headers['Authorization'] = `Bearer ${req.token}`

  try {
    const response = await fetch(`${BASE_URL}${req.path}`, {
      method: 'GET',
      headers,
      signal: abort.signal
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream')) {
      activeStreams.delete(req.streamId)
      const text = await response.text()
      return {
        status: response.status,
        ok: response.ok,
        body: parseResponseBody(text)
      }
    }

    void pumpSse(event, req.streamId, response, abort)
    return { status: response.status, ok: response.ok, body: null }
  } catch (err) {
    activeStreams.delete(req.streamId)
    return {
      status: 0,
      ok: false,
      body: null,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}

function handleStreamCancel(streamId: string): void {
  activeStreams.get(streamId)?.abort()
  activeStreams.delete(streamId)
}

/** Register the `api:request` IPC handler. Call once after app is ready. */
export function registerApiProxy(): void {
  ipcMain.handle('api:request', (_event, req: ApiRequest) => handleRequest(req))
  ipcMain.handle('api:stream:start', (event, req: ApiStreamRequest) =>
    handleStreamStart(event, req)
  )
  ipcMain.handle('api:stream:cancel', (_event, streamId: string) => handleStreamCancel(streamId))
}
