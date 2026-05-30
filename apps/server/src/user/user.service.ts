import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import bcrypt from 'bcrypt'
import { BusinessException } from '../common/index.js'
import { User } from './entities/user.entity.js'
import { RegisterDto } from './dto/register.dto.js'
import { LoginDto } from './dto/login.dto.js'
import type { LoginResult, UserView } from './dto/user-view.dto.js'
import { toUserView } from './mappers/user.mapper.js'
import { TokenService } from './auth/token.service.js'
import type { JwtPayload } from './auth/auth.types.js'

/** bcrypt 哈希轮数 */
const SALT_ROUNDS = 10

/**
 * UserService —— 用户管理全部业务逻辑与 DB 访问。
 *
 * 注册/登录无需鉴权；退出登录/注销/获取信息由 Controller 上的 JwtAuthGuard 保护，
 * 守卫已载入 user 与 token 载荷，故这些方法直接接收实体/载荷，不再重复查库。
 */
@Injectable()
export class UserService {
    constructor(
        @InjectRepository(User) private readonly userRepo: Repository<User>,
        private readonly tokenService: TokenService
    ) {}

    /** 注册：account 唯一，密码哈希存储。不自动登录。 */
    async register(dto: RegisterDto): Promise<UserView> {
        const existing = await this.userRepo.findOne({ where: { account: dto.account } })
        if (existing) {
            throw BusinessException.conflict('账号已存在')
        }
        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS)
        const user = this.userRepo.create({
            account: dto.account,
            passwordHash,
            nickname: null,
            email: null,
            avatar: null,
            status: 'active'
        })
        const saved = await this.userRepo.save(user)
        return toUserView(saved)
    }

    /** 登录：校验账号密码，签发 token。账号不存在/已注销/密码错均回同一错误，不泄露具体原因。 */
    async login(dto: LoginDto): Promise<LoginResult> {
        const user = await this.userRepo.findOne({
            where: { account: dto.account },
            // passwordHash 实体侧 select:false，这里显式取出用于比对
            select: [
                'id',
                'account',
                'passwordHash',
                'nickname',
                'email',
                'avatar',
                'status',
                'createdAt'
            ]
        })
        if (!user || user.status !== 'active') {
            throw BusinessException.invalidCredentials('账号或密码错误')
        }
        const matched = await bcrypt.compare(dto.password, user.passwordHash)
        if (!matched) {
            throw BusinessException.invalidCredentials('账号或密码错误')
        }
        const { token, expiresIn } = await this.tokenService.issue(user.id)
        return { token, expiresIn, user: toUserView(user) }
    }

    /** 退出登录：把当前 token 加入黑名单。 */
    async logout(payload: JwtPayload): Promise<{ success: true }> {
        await this.tokenService.revoke(payload)
        return { success: true }
    }

    /** 注销账号（逻辑删除）：status 置 deactivated，并即时吊销当前 token。 */
    async deactivate(user: User, payload: JwtPayload): Promise<{ deactivated: true }> {
        await this.userRepo.update({ id: user.id }, { status: 'deactivated' })
        await this.tokenService.revoke(payload)
        return { deactivated: true }
    }

    /** 获取当前用户信息（守卫已载入实体）。 */
    getMe(user: User): UserView {
        return toUserView(user)
    }
}
