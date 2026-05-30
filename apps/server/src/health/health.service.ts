import { Inject, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
// Redis 暂未使用，健康检查暂不探测 Redis（如需启用，取消以下及下方相关注释）
// import { Redis } from 'ioredis'
// import { REDIS_CLIENT } from '../redis/redis.module.js'

export interface HealthStatus {
  status: 'ok' | 'degraded'
  mysql: 'up' | 'down'
  // redis: 'up' | 'down' // Redis 暂未使用
  timestamp: string
}

@Injectable()
export class HealthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    // @Inject(REDIS_CLIENT) private readonly redis: Redis, // Redis 暂未使用
  ) {}

  async check(): Promise<HealthStatus> {
    const mysql = await this.pingMysql()
    const status: HealthStatus['status'] = mysql === 'up' ? 'ok' : 'degraded'
    return {
      status,
      mysql,
      // redis, // Redis 暂未使用
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

  // Redis 暂未使用，探测方法暂时停用。如需启用，恢复上面的注入与字段后取消注释。
  // private async pingRedis(): Promise<'up' | 'down'> {
  //   try {
  //     const reply = await this.redis.ping()
  //     return reply === 'PONG' ? 'up' : 'down'
  //   } catch {
  //     return 'down'
  //   }
  // }
}
