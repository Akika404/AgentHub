import {
  ERROR_CODE,
  SUCCESS_CODE,
  type ApiResponse,
  type ImportedSkillFolderView,
  type ImportLocalSkillFolderPayload,
  type ServerDirectoryListing,
  type ServerDirectoryRoot
} from '@agenthub/shared'
import { getToken, onUnauthorized } from '../stores/auth'
import { ApiError, http } from './http'

function pathQuery(path?: string): string {
  const trimmed = path?.trim()
  return trimmed ? `?path=${encodeURIComponent(trimmed)}` : ''
}

async function unwrapUploadResponse<T>(
  res: Awaited<ReturnType<typeof window.api.upload>>
): Promise<T> {
  if (res.status === 0) {
    throw new ApiError(-1, res.error ?? '无法连接到服务器，请确认后端已启动')
  }

  const envelope = res.body as ApiResponse<T> | null
  if (!envelope || typeof envelope.code !== 'number') {
    throw new ApiError(res.status, `请求失败（HTTP ${res.status}）`)
  }

  if (envelope.code === SUCCESS_CODE) return envelope.data as T
  if (envelope.code === ERROR_CODE.UNAUTHORIZED) onUnauthorized()
  throw new ApiError(envelope.code, envelope.message || `请求失败（code ${envelope.code}）`)
}

function manifestBuffer(payload: ImportLocalSkillFolderPayload): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(payload)).buffer as ArrayBuffer
}

async function importLocalSkillFolder(
  payload: ImportLocalSkillFolderPayload
): Promise<ImportedSkillFolderView> {
  const res = await window.api.upload({
    path: '/workspace-fs/skills/import-local',
    fieldName: 'manifest',
    token: getToken() ?? undefined,
    file: {
      name: 'skill-folder-manifest.json',
      type: 'application/json',
      data: manifestBuffer(payload)
    }
  })
  return unwrapUploadResponse<ImportedSkillFolderView>(res)
}

export const workspaceFsApi = {
  roots: () => http.get<ServerDirectoryRoot[]>('/workspace-fs/roots'),
  directories: (path?: string) =>
    http.get<ServerDirectoryListing>(`/workspace-fs/directories${pathQuery(path)}`),
  importLocalSkillFolder
}
