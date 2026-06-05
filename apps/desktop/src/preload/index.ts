import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/** Mirror of the main-process `ApiRequest` shape (kept local to avoid coupling). */
interface ApiRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: string
  body?: unknown
  token?: string
}

interface ApiStreamRequest {
  streamId: string
  path: string
  token?: string
}

type StreamEventName = 'event' | 'error' | 'done'

// Custom APIs for renderer: a single typed channel onto the main-process HTTP proxy.
const api = {
  request: (req: ApiRequest) => ipcRenderer.invoke('api:request', req),
  streamStart: (req: ApiStreamRequest) => ipcRenderer.invoke('api:stream:start', req),
  streamCancel: (streamId: string) => ipcRenderer.invoke('api:stream:cancel', streamId),
  selectDirectory: () => ipcRenderer.invoke('dialog:select-directory') as Promise<string | null>,
  selectDirectories: () => ipcRenderer.invoke('dialog:select-directories') as Promise<string[]>,
  onStream: (name: StreamEventName, callback: (payload: unknown) => void) => {
    const channel = `api:stream:${name}`
    const listener = (_event: IpcRendererEvent, payload: unknown): void => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
