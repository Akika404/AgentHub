import { Inject, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import Redis from 'ioredis'
import { REDIS_CLIENT } from '../redis/redis.module'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  mysql: 'up' | 'down'
  redis: 'up' | 'down'
  timestamp: string
}

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(): Promise<HealthStatus> {
    const [mysql, redis] = await Promise.all([this.pingMysql(), this.pingRedis()])
    const status: HealthStatus['status'] = mysql === 'up' && redis === 'up' ? 'ok' : 'degraded'
    return {
      status,
      mysql,
      redis,
      timestamp: new Date().toISOString(),
    }
  }

  private async pingMysql(): Promise<'up' | 'down'> {
    try {
      await this.dataSource.query('SELECT 1')
      return 'up'
    } catch {
      return 'down'
    }
  }

  private async pingRedis(): Promise<'up' | 'down'> {
    try {
      const reply = await this.redis.ping()
      return reply === 'PONG' ? 'up' : 'down'
    } catch {
      return 'down'
    }
  }
}
