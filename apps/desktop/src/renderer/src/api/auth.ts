import type {
  LoginPayload,
  LoginResult,
  RegisterPayload,
  UpdateUserPayload,
  UserView
} from '@agenthub/shared'
import { http } from './http'

/** User module client. Maps `/api/user/*`. */
export const authApi = {
  register: (payload: RegisterPayload) => http.post<UserView>('/user/register', payload),
  login: (payload: LoginPayload) => http.post<LoginResult>('/user/login', payload),
  logout: () => http.post<{ success: true }>('/user/logout'),
  getMe: () => http.get<UserView>('/user/me'),
  updateUser: (payload: UpdateUserPayload) => http.post<UserView>('/user/update', payload),
  deleteMe: () => http.delete<{ deactivated: true }>('/user/me')
}
