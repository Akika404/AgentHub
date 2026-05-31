import { reactive } from 'vue'
import type { LoginPayload, RegisterPayload, UpdateUserPayload, UserView } from '@agenthub/shared'
import { authApi } from '../api/auth'

const STORAGE_KEY = 'agenthub.auth'

interface AuthState {
  token: string | null
  user: UserView | null
  /** true once the initial rehydrate + validation has settled */
  ready: boolean
}

interface PersistedAuth {
  token: string
  user: UserView
}

function readPersisted(): PersistedAuth | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedAuth
    if (parsed && typeof parsed.token === 'string' && parsed.user) return parsed
    return null
  } catch {
    return null
  }
}

function writePersisted(value: PersistedAuth | null): void {
  try {
    if (value) globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(value))
    else globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {
    /* storage may be unavailable; tolerate silently */
  }
}

const persisted = readPersisted()

export const authState = reactive<AuthState>({
  token: persisted?.token ?? null,
  user: persisted?.user ?? null,
  ready: false
})

/** Non-reactive token accessor for the HTTP layer (avoids importing the store ref). */
export function getToken(): string | null {
  return authState.token
}

export function isAuthenticated(): boolean {
  return Boolean(authState.token && authState.user)
}

function setSession(token: string, user: UserView): void {
  authState.token = token
  authState.user = user
  writePersisted({ token, user })
}

function clearSession(): void {
  authState.token = null
  authState.user = null
  writePersisted(null)
}

/** Called by the HTTP layer when the server reports the token is invalid. */
export function onUnauthorized(): void {
  clearSession()
}

export async function login(payload: LoginPayload): Promise<void> {
  const result = await authApi.login(payload)
  setSession(result.token, result.user)
}

/** Backend register does not auto-login; we log in right after for a smooth flow. */
export async function register(payload: RegisterPayload): Promise<void> {
  await authApi.register(payload)
  await login({ account: payload.account, password: payload.password })
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout()
  } catch {
    /* even if the server call fails, drop the local session */
  }
  clearSession()
}

export async function updateProfile(payload: UpdateUserPayload): Promise<UserView> {
  const user = await authApi.updateUser(payload)
  authState.user = user
  if (authState.token) writePersisted({ token: authState.token, user })
  return user
}

/**
 * Rehydrate on startup: if a persisted token exists, validate it via `/user/me`.
 * Invalid/expired tokens are cleared. Marks `ready` when settled.
 */
export async function initAuth(): Promise<void> {
  if (authState.token) {
    try {
      const user = await authApi.getMe()
      authState.user = user
      writePersisted({ token: authState.token, user })
    } catch {
      clearSession()
    }
  }
  authState.ready = true
}

/** Avatar shape consumed by the sidebar (mirrors mock `CurrentUser`). */
export interface SidebarAvatar {
  name: string
  initials: string
  avatarDataUrl?: string | null
}

export function userToAvatar(user: UserView | null): SidebarAvatar | null {
  if (!user) return null
  const name = user.nickname?.trim() || user.account
  return {
    name,
    initials: name.slice(0, 2).toUpperCase(),
    avatarDataUrl: user.avatar
  }
}
