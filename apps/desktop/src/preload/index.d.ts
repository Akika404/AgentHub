import { ElectronAPI } from '@electron-toolkit/preload'
import type { ImportLocalSkillFolderPayload } from '@agenthub/shared'

/** Request forwarded to the main-process HTTP proxy. */
export interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  token?: string
}

export interface ApiStreamRequest {
  streamId: string
  path: string
  token?: string
}

export interface ApiUploadRequest {
  path: string
  fieldName?: string
  file: {
    name: string
    type?: string
    data: ArrayBuffer
  }
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
  upload(req: ApiUploadRequest): Promise<ApiProxyResponse>
  streamStart(req: ApiStreamRequest): Promise<ApiProxyResponse>
  streamCancel(streamId: string): Promise<void>
  selectDirectory(): Promise<string | null>
  selectDirectories(): Promise<string[]>
  importLocalSkillFolder(): Promise<ImportLocalSkillFolderPayload | null>
  /** Register self-contained preview HTML; returns an `agent-preview://` URL to load in an iframe. */
  registerPreviewHtml(html: string): Promise<string>
  /** Release a previously registered preview URL so its HTML can be garbage-collected. */
  releasePreviewHtml(url: string): Promise<void>
  /** Start/restart the local-execution runner reverse channel with the current JWT. */
  runnerStart(token: string): Promise<void>
  /** Stop the local-execution runner. */
  runnerStop(): Promise<void>
  onStream(name: 'event' | 'error' | 'done', callback: (payload: unknown) => void): () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RendererApi
  }
}
