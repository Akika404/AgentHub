import { ipcMain } from 'electron'

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

/** Register the `api:request` IPC handler. Call once after app is ready. */
export function registerApiProxy(): void {
  ipcMain.handle('api:request', (_event, req: ApiRequest) => handleRequest(req))
}
