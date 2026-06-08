import type { ServerDirectoryListing, ServerDirectoryRoot } from '@agenthub/shared'
import { http } from './http'

function pathQuery(path?: string): string {
  const trimmed = path?.trim()
  return trimmed ? `?path=${encodeURIComponent(trimmed)}` : ''
}

export const workspaceFsApi = {
  roots: () => http.get<ServerDirectoryRoot[]>('/workspace-fs/roots'),
  directories: (path?: string) =>
    http.get<ServerDirectoryListing>(`/workspace-fs/directories${pathQuery(path)}`)
}
