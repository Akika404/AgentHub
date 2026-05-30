import type { UserStatus } from '../entities/user.entity.js'

/**
 * 对外返回的用户视图。
 * 与实体分离：剥离 passwordHash 等敏感/内部字段。
 */
export interface UserView {
    id: string
    /** 登录名 */
    account: string
    /** 展示名 */
    nickname: string | null
    email: string | null
    /** 头像 URL / data URL */
    avatar: string | null
    status: UserStatus
    /** 创建时间，ISO8601 */
    createdAt: string
}

/** 登录成功返回：token + 用户视图。 */
export interface LoginResult {
    /** JWT access token，放 Authorization: Bearer 使用 */
    token: string
    /** token 有效期（秒） */
    expiresIn: number
    user: UserView
}
