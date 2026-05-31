import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserController } from './user.controller.js'
import { UserService } from './user.service.js'
import { User } from './entities/user.entity.js'
import { TokenService } from './auth/token.service.js'
import { JwtAuthGuard } from './auth/jwt-auth.guard.js'

/**
 * UserModule —— 用户管理 + JWT 认证基座。
 *
 * 注册 User 实体（autoLoadEntities 已开，forFeature 即建表）；JwtModule 从 env 读取
 * 密钥与有效期。导出 JwtAuthGuard，供未来其他模块复用同一套鉴权。
 * 依赖全局 RedisModule 提供的 REDIS_CLIENT（token 黑名单），需在 AppModule 启用 RedisModule。
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([User]),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET', 'change-me-in-production'),
                // jsonwebtoken 把 expiresIn 收窄为 number | ms 的 StringValue，
                // ConfigService 返回宽泛 string，这里转成对应类型
                signOptions: {
                    expiresIn: config.get<string>(
                        'JWT_EXPIRES_IN',
                        '7d'
                    ) as JwtSignOptions['expiresIn']
                }
            })
        })
    ],
    controllers: [UserController],
    providers: [UserService, TokenService, JwtAuthGuard],
    // 导出 JwtAuthGuard 供其他模块整体鉴权；guard 依赖 TokenService 与 User 仓储，
    // 在消费模块的注入上下文里实例化，故二者也须导出（TypeOrmModule 再导出 forFeature 的仓储）。
    exports: [JwtAuthGuard, TokenService, TypeOrmModule]
})
export class UserModule {}
