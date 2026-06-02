/**
 * User module contract. Mirrors `apps/server/src/user/dto/*`.
 */

export type UserStatus = 'active' | 'deactivated'

/** Outward user view (passwordHash stripped). */
export interface UserView {
  id: string
  /** login name, unique & immutable */
  account: string
  /** display name */
  nickname: string | null
  email: string | null
  /** avatar URL / compact data URL (<= 256 KiB) */
  avatar: string | null
  status: UserStatus
  /** ISO8601 */
  createdAt: string
}

/** Login success payload. */
export interface LoginResult {
  /** JWT access token, used as `Authorization: Bearer <token>` */
  token: string
  /** token lifetime in seconds */
  expiresIn: number
  user: UserView
}

/** Register input: account + password only (no auto-login). */
export interface RegisterPayload {
  account: string
  password: string
}

/** Login input. */
export interface LoginPayload {
  account: string
  password: string
}

/**
 * Partial profile update. Omit a field to keep it; pass `null` to clear it.
 * Only `nickname` / `avatar` are currently mutable.
 */
export interface UpdateUserPayload {
  nickname?: string | null
  /** avatar URL / compact data URL (<= 256 KiB) */
  avatar?: string | null
}
