import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RedisModule } from './redis/redis.module.js'
import { HealthController } from './health/health.controller.js'
import { HealthService } from './health/health.service.js'
import { AgentsModule } from './multiagents/agents.module.js'
import { GroupChatModule } from './multiagents/group/group-chat.module.js'
import { UserModule } from './user/user.module.js'
import { PlatformProviderModule } from './platform-provider/platform-provider.module.js'
import { WorkspaceFsModule } from './workspace-fs/workspace-fs.module.js'

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: ['.env.local', '.env']
        }),
        TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
                type: 'mysql',
                host: config.get<string>('MYSQL_HOST', '127.0.0.1'),
                port: config.get<number>('MYSQL_PORT', 3306),
                username: config.get<string>('MYSQL_USER', 'root'),
                password: config.get<string>('MYSQL_PASSWORD', ''),
                database: config.get<string>('MYSQL_DATABASE', 'agent_hub'),
                autoLoadEntities: true,
                synchronize: config.get<string>('NODE_ENV') !== 'production',
                timezone: config.get<string>('MYSQL_TIMEZONE', '+08:00'),
                charset: 'utf8mb4'
            })
        }),
        // Redis：用户模块的 token 黑名单依赖它（@Global，导出 REDIS_CLIENT）
        RedisModule,
        AgentsModule,
        GroupChatModule,
        UserModule,
        PlatformProviderModule,
        WorkspaceFsModule
    ],
    controllers: [HealthController],
    providers: [HealthService]
})
export class AppModule {}
