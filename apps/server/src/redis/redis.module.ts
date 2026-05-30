import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'

export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService): Redis => {
                return new Redis({
                    host: config.get<string>('REDIS_HOST', '127.0.0.1'),
                    port: config.get<number>('REDIS_PORT', 6379),
                    password: config.get<string>('REDIS_PASSWORD') || undefined,
                    db: config.get<number>('REDIS_DB', 0),
                    lazyConnect: false,
                    maxRetriesPerRequest: 3
                })
            }
        }
    ],
    exports: [REDIS_CLIENT]
})
export class RedisModule {}
