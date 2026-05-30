import type { Request } from 'express'
import type { User } from '../entities/user.entity.js'

/**
 * JWT 载荷。
 * - sub：用户 id
 * - jti：token 唯一 id，用于服务端黑名单（退出登录/注销）
 * - iat / exp：签发与过期时间（unix 秒），由签发时自动写入
 */
export interface JwtPayload {
    sub: string
    jti: string
    iat: number
    exp: number
}

/** 经 JwtAuthGuard 鉴权后的请求：已挂载 user 与 token 载荷。 */
export interface AuthenticatedRequest extends Request {
    user: User
    tokenPayload: JwtPayload
}
