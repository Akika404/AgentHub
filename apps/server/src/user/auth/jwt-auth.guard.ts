import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { BusinessException } from '../../common/index.js'
import { User } from '../entities/user.entity.js'
import type { AuthenticatedRequest } from './auth.types.js'
import { TokenService } from './token.service.js'

/**
 * JwtAuthGuard —— 保护需要登录的路由。
 *
 * 流程：取 Bearer token → 校验签名/过期 → 查黑名单（是否已退出/注销）→ 按 sub 载入用户 →
 * 校验账号状态。通过后把 user 与 token 载荷挂到 request，供 @CurrentUser() / @AuthPayload() 取用。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly tokenService: TokenService,
        @InjectRepository(User) private readonly userRepo: Repository<User>
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
        const token = this.extractToken(request)
        if (!token) {
            throw BusinessException.unauthorized('缺少登录凭证')
        }

        const payload = await this.tokenService.verify(token)
        if (await this.tokenService.isRevoked(payload.jti)) {
            throw BusinessException.unauthorized('登录已失效，请重新登录')
        }

        const user = await this.userRepo.findOne({ where: { id: payload.sub } })
        if (!user) {
            throw BusinessException.unauthorized('用户不存在')
        }
        if (user.status !== 'active') {
            throw BusinessException.accountDeactivated('账号已注销')
        }

        request.user = user
        request.tokenPayload = payload
        return true
    }

    private extractToken(request: AuthenticatedRequest): string | null {
        const header = request.headers.authorization
        if (!header) return null
        const [scheme, value] = header.split(' ')
        return scheme === 'Bearer' && value ? value : null
    }
}
