import type {
  CreateProviderPayload,
  PlatformProviderView,
  ProviderTestResult,
  UpdateProviderPayload
} from '@agenthub/shared'
import { http } from './http'

/** Platform-provider module client. Maps `/api/platform-providers/*`. */
export const providerApi = {
  list: () => http.get<PlatformProviderView[]>('/platform-providers'),
  get: (id: string) => http.get<PlatformProviderView>(`/platform-providers/${id}`),
  create: (payload: CreateProviderPayload) =>
    http.post<PlatformProviderView>('/platform-providers', payload),
  update: (id: string, payload: UpdateProviderPayload) =>
    http.patch<PlatformProviderView>(`/platform-providers/${id}`, payload),
  delete: (id: string) => http.delete<{ deleted: true }>(`/platform-providers/${id}`),
  test: (id: string) => http.post<ProviderTestResult>(`/platform-providers/${id}/test`),
  refreshModels: (id: string) =>
    http.post<PlatformProviderView>(`/platform-providers/${id}/models/refresh`)
}
