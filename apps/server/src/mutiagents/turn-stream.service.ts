import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from '../redis/redis.module.js'
import type { AgentEvent } from './adapter/index.js'

/**
 * TurnStream — 一轮对话（turn）的事件广播与回放底层，基于 Redis Streams。
 *
 * 一个 turn 对应一条 Redis Stream（`agent:turn:{turnId}:events`）。runTurn 把每条
 * AgentEvent `XADD` 进去；任意数量的订阅者各自从头 `XRANGE` 回放、再 `XREAD BLOCK`
 * 追尾，遇 `done` 事件结束——天然支持多端同时实时围观同一个 turn。
 *
 * 另维护两类轻量元数据：
 * - `agent:session:{sessionId}:activeturn` —— 指向该会话当前活跃 turnId，
 *   用 `SET NX` 兼作跨实例并发互斥锁（同一会话同时只允许一轮）。
 * - `agent:turn:control` —— pub/sub 频道，承载跨实例 abort 信号。
 */
@Injectable()
export class TurnStream implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(TurnStream.name)
    /** 专用订阅连接（pub/sub 会独占连接，不能复用主连接） */
    private subscriber: Redis | null = null
    private abortHandler: ((turnId: string) => void) | null = null

    private static readonly CONTROL_CHANNEL = 'agent:turn:control'
    private static readonly BLOCK_MS = 15_000
    private static readonly MAX_EVENTS = 5_000
    /** turn 结束后事件流保留时长（秒）；之后晚到的端回退读 DB 历史 */
    private static readonly STREAM_TTL_SEC = 60 * 60
    /** 活跃指针安全 TTL（秒）；进程崩溃未清理时自动过期，避免会话被永久锁死 */
    private static readonly ACTIVE_TTL_SEC = 2 * 60 * 60

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    onModuleInit(): void {
        this.subscriber = this.redis.duplicate()
        void this.subscriber.subscribe(TurnStream.CONTROL_CHANNEL).catch((err) => {
            this.logger.error(`Failed to subscribe control channel: ${this.errMsg(err)}`)
        })
        this.subscriber.on('message', (channel, message) => {
            if (channel === TurnStream.CONTROL_CHANNEL && this.abortHandler) {
                this.abortHandler(message)
            }
        })
    }

    onModuleDestroy(): void {
        this.subscriber?.disconnect()
        this.subscriber = null
    }

    private eventsKey(turnId: string): string {
        return `agent:turn:${turnId}:events`
    }

    private activeKey(sessionId: string): string {
        return `agent:session:${sessionId}:activeturn`
    }

    /**
     * 尝试把 sessionId 标记为「有一轮在跑」。返回最终持锁的 turnId：
     * - 抢锁成功 → 返回传入的 turnId（调用方应启动 runTurn）
     * - 已有活跃轮 → 返回既存 turnId（调用方应拒绝新 turn 或引导订阅既存轮）
     */
    async acquireActiveTurn(sessionId: string, turnId: string): Promise<string> {
        const key = this.activeKey(sessionId)
        while (true) {
            const ok = await this.redis.set(key, turnId, 'EX', TurnStream.ACTIVE_TTL_SEC, 'NX')
            if (ok === 'OK') return turnId

            const existing = await this.redis.get(key)
            if (existing) return existing
            // The previous active key expired or was released between SET NX and GET.
            // Retry so the caller never starts a turn without holding the Redis lock.
        }
    }

    /** 释放活跃指针（仅当持有者是自己这一轮时才删，避免误删后继轮） */
    async releaseActiveTurn(sessionId: string, turnId: string): Promise<void> {
        const current = await this.redis.get(this.activeKey(sessionId))
        if (current === turnId) await this.redis.del(this.activeKey(sessionId))
    }

    /** 读取某会话当前活跃 turnId（无则 null）。供 AgentChatView.activeTurnId 用 */
    async getActiveTurn(sessionId: string): Promise<string | null> {
        return this.redis.get(this.activeKey(sessionId))
    }

    /** 批量读取多个会话的活跃 turnId，供列表视图一次性填充 */
    async getActiveTurns(sessionIds: string[]): Promise<Map<string, string>> {
        const result = new Map<string, string>()
        if (sessionIds.length === 0) return result
        const values = await this.redis.mget(sessionIds.map((id) => this.activeKey(id)))
        sessionIds.forEach((id, i) => {
            const v = values[i]
            if (v) result.set(id, v)
        })
        return result
    }

    /** 追加一条事件到 turn 的事件流 */
    async publish(turnId: string, event: AgentEvent): Promise<void> {
        await this.redis.xadd(
            this.eventsKey(turnId),
            'MAXLEN',
            '~',
            TurnStream.MAX_EVENTS,
            '*',
            'ev',
            JSON.stringify(event)
        )
    }

    /** turn 收尾：给事件流加 TTL，让历史在窗口期内仍可回放，之后自动清理 */
    async finalize(turnId: string): Promise<void> {
        await this.redis.expire(this.eventsKey(turnId), TurnStream.STREAM_TTL_SEC)
    }

    /**
     * 订阅一个 turn 的事件：先回放已发生的全部事件，再实时追尾，遇 `done` 结束。
     * 每个订阅者用独立连接与游标，互不影响——这是多端围观的核心。
     */
    async *subscribe(sessionId: string, turnId: string): AsyncIterable<AgentEvent> {
        const conn = this.redis.duplicate()
        const key = this.eventsKey(turnId)
        try {
            let lastId = '0'

            const backlog = await conn.xrange(key, '-', '+')
            for (const [id, fields] of backlog) {
                lastId = id
                const event = this.decode(fields)
                if (!event) continue
                yield event
                if (event.type === 'done') return
            }

            while (true) {
                const res = (await conn.xread(
                    'BLOCK',
                    TurnStream.BLOCK_MS,
                    'STREAMS',
                    key,
                    lastId
                )) as Array<[string, Array<[string, string[]]>]> | null

                if (!res) {
                    // 阻塞超时：若该会话已无活跃轮，说明 turn 已结束且无新事件，收尾退出
                    const active = await this.redis.get(this.activeKey(sessionId))
                    if (active !== turnId) return
                    continue
                }

                for (const [, entries] of res) {
                    for (const [id, fields] of entries) {
                        lastId = id
                        const event = this.decode(fields)
                        if (!event) continue
                        yield event
                        if (event.type === 'done') return
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    /** 跨实例请求中止某 turn：广播到控制频道，由持有该 turn 的实例响应 */
    async requestAbort(turnId: string): Promise<void> {
        await this.redis.publish(TurnStream.CONTROL_CHANNEL, turnId)
    }

    /**
     * 启动时回收残留的活跃 turn。进程重启会让游离的 runTurn 任务消失，但 Redis 里的
     * 活跃指针仍在，会把会话误报为「有一轮在跑」、并让缓存了该轮的端一直等不到 done。
     * 这里为每个残留轮补发一条 done（让订阅端干净收尾）、给事件流设 TTL，并删除指针。
     *
     * 仅适用于单实例部署：多实例下别的实例可能正持有这些轮，重启端不应清理它们，
     * 应关闭本回收（见 AGENT_RECLAIM_ON_BOOT），改由活跃指针的安全 TTL 兜底。
     */
    async reclaimStaleActiveTurns(): Promise<number> {
        let cursor = '0'
        let reclaimed = 0
        const pattern = 'agent:session:*:activeturn'
        do {
            const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
            cursor = next
            for (const key of keys) {
                const turnId = await this.redis.get(key)
                if (turnId) {
                    // vendor 未知，对前端 done 处理无影响；success=false 标记为被中断
                    await this.publish(turnId, {
                        type: 'done',
                        vendor: 'claude',
                        success: false
                    }).catch(() => undefined)
                    await this.finalize(turnId).catch(() => undefined)
                }
                await this.redis.del(key)
                reclaimed++
            }
        } while (cursor !== '0')
        return reclaimed
    }

    /** 注册中止处理器：收到控制频道消息时，由 AgentManager 决定是否命中本地 turn */
    onAbortRequest(handler: (turnId: string) => void): void {
        this.abortHandler = handler
    }

    private decode(fields: string[]): AgentEvent | null {
        const idx = fields.indexOf('ev')
        if (idx < 0 || idx + 1 >= fields.length) return null
        try {
            return JSON.parse(fields[idx + 1]) as AgentEvent
        } catch {
            return null
        }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
