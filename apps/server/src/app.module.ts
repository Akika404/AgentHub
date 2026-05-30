import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
// Redis 暂未使用，初始化已停用（如需启用：取消本行及下方 imports 中 RedisModule 的注释）
// import { RedisModule } from './redis/redis.module.js'
import { HealthController } from './health/health.controller.js'
import { HealthService } from './health/health.service.js'
import { AgentsModule } from './mutiagents/agents.module.js'

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
                timezone: 'Z',
                charset: 'utf8mb4'
            })
        }),
        // RedisModule, // Redis 暂未使用，初始化已停用
        AgentsModule
    ],
    controllers: [HealthController],
    providers: [HealthService]
})
export class AppModule {}
