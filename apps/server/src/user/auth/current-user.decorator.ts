import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { User } from '../entities/user.entity.js'
import type { AuthenticatedRequest, JwtPayload } from './auth.types.js'

/** 取当前登录用户（由 JwtAuthGuard 挂载）。 */
export const CurrentUser = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): User => {
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
        return request.user
    }
)

/** 取当前 token 载荷（含 jti/exp，用于退出登录/注销时吊销）。 */
export const AuthPayload = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): JwtPayload => {
        const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
        return request.tokenPayload
    }
)
