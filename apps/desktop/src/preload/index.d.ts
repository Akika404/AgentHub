import { ElectronAPI } from '@electron-toolkit/preload'

/** Request forwarded to the main-process HTTP proxy. */
export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  token?: string
}

/** Response returned by the main-process HTTP proxy. */
export interface ApiProxyResponse {
  /** HTTP status; 0 when the request never reached the server */
  status: number
  ok: boolean
  /** parsed JSON body, or null */
  body: unknown
  /** transport-level error message */
  error?: string
}

export interface RendererApi {
  request(req: ApiRequest): Promise<ApiProxyResponse>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}
