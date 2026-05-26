import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { RedisModule } from './redis/redis.module'
import { HealthController } from './health/health.controller'
import { HealthService } from './health/health.service'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: config.get<string>('MYSQL_HOST', '127.0.0.1'),
        port: config.get<number>('MYSQL_PORT', 3306),
        username: config.get<string>('MYSQL_USER', 'root'),
        password: config.get<string>('MYSQL_PASSWORD', ''),
        database: config.get<string>('MYSQL_DATABASE', 'agenthub'),
        autoLoadEntities: true,
        synchronize: config.get<string>('NODE_ENV') !== 'production',
        timezone: 'Z',
        charset: 'utf8mb4',
      }),
    }),
    RedisModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
