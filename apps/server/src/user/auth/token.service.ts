import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { REDIS_CLIENT } from '../../redis/redis.module.js'
import { BusinessException } from '../../common/index.js'
import type { JwtPayload } from './auth.types.js'

/** Redis 黑名单键前缀：按 jti 存被吊销的 token，TTL = token 剩余有效期。 */
const BLACKLIST_PREFIX = 'auth:blacklist:'

/**
 * TokenService —— JWT 的签发/校验 + 服务端吊销（黑名单）。
 *
 * 纯无状态 JWT 本身无法在服务端注销；这里给每个 token 一个 jti，退出登录/注销时把 jti
 * 写入 Redis 黑名单（TTL 取 token 剩余有效期，到期自动清理），Guard 每次校验时查黑名单。
 */
@Injectable()
export class TokenService {
    constructor(
        private readonly jwt: JwtService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis
    ) {}

    /** 为用户签发 token，返回 token 文本与有效期（秒）。 */
    async issue(userId: string): Promise<{ token: string; expiresIn: number }> {
        const jti = crypto.randomUUID()
        const token = await this.jwt.signAsync({ sub: userId }, { jwtid: jti })
        const payload = this.jwt.decode(token) as JwtPayload
        const expiresIn = payload.exp - payload.iat
        return { token, expiresIn }
    }

    /** 校验 token，返回载荷；非法/过期则抛 BusinessException.unauthorized。 */
    async verify(token: string): Promise<JwtPayload> {
        try {
            return await this.jwt.verifyAsync<JwtPayload>(token)
        } catch {
            throw BusinessException.unauthorized('登录凭证无效或已过期')
        }
    }

    /** jti 是否在黑名单中（已被吊销）。 */
    async isRevoked(jti: string): Promise<boolean> {
        const exists = await this.redis.exists(BLACKLIST_PREFIX + jti)
        return exists === 1
    }

    /** 吊销该 token：写黑名单，TTL = exp 距今的剩余秒数。 */
    async revoke(payload: JwtPayload): Promise<void> {
        const ttl = payload.exp - Math.floor(Date.now() / 1000)
        if (ttl <= 0) return
        await this.redis.set(BLACKLIST_PREFIX + payload.jti, '1', 'EX', ttl)
    }
}
