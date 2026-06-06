import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Redis } from 'ioredis'
import type { GroupRunEvent } from '@agenthub/shared'
import { REDIS_CLIENT } from '../../../redis/redis.module.js'

/**
 * GroupRunStream — 一次群运行（group run）的事件广播与回放底层，基于 Redis Streams。
 *
 * 沿用单聊 TurnStream 范式，但：
 * - 事件类型是 `GroupRunEvent`（编排计划 / 任务状态 / 成员 turn 透传 / 黑板更新 / 汇报 / done）；
 * - 活跃指针锁的粒度是「群」而非「会话」——一个群同时只允许一轮在跑。
 *
 * 一次群运行 = 一条 Redis Stream（`group:run:{runId}:events`）。任意数量订阅者各自
 * `XRANGE` 回放 + `XREAD BLOCK` 追尾，遇 `done` 结束 —— 天然多端围观。
 */
@Injectable()
export class GroupRunStream implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(GroupRunStream.name)
    private subscriber: Redis | null = null
    private abortHandler: ((runId: string) => void) | null = null

    private static readonly CONTROL_CHANNEL = 'group:run:control'
    private static readonly BLOCK_MS = 15_000
    private static readonly MAX_EVENTS = 5_000
    private static readonly STREAM_TTL_SEC = 60 * 60
    private static readonly ACTIVE_TTL_SEC = 2 * 60 * 60

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

    onModuleInit(): void {
        this.subscriber = this.redis.duplicate()
        void this.subscriber.subscribe(GroupRunStream.CONTROL_CHANNEL).catch((err) => {
            this.logger.error(`Failed to subscribe control channel: ${this.errMsg(err)}`)
        })
        this.subscriber.on('message', (channel, message) => {
            if (channel === GroupRunStream.CONTROL_CHANNEL && this.abortHandler) {
                this.abortHandler(message)
            }
        })
    }

    onModuleDestroy(): void {
        this.subscriber?.disconnect()
        this.subscriber = null
    }

    private eventsKey(runId: string): string {
        return `group:run:${runId}:events`
    }

    private activeKey(groupId: string): string {
        return `group:${groupId}:activerun`
    }

    private runGroupKey(runId: string): string {
        return `group:run:${runId}:group`
    }

    /** 抢占群活跃轮锁。返回最终持锁的 runId：== 传入则抢占成功，否则群已有活跃轮。 */
    async acquireActiveRun(groupId: string, runId: string): Promise<string> {
        const key = this.activeKey(groupId)
        while (true) {
            const ok = await this.redis.set(key, runId, 'EX', GroupRunStream.ACTIVE_TTL_SEC, 'NX')
            if (ok === 'OK') {
                try {
                    await this.redis.set(
                        this.runGroupKey(runId),
                        groupId,
                        'EX',
                        GroupRunStream.ACTIVE_TTL_SEC
                    )
                } catch (err) {
                    await this.releaseActiveRun(groupId, runId).catch(() => undefined)
                    throw err
                }
                return runId
            }
            const existing = await this.redis.get(key)
            if (existing) return existing
        }
    }

    async releaseActiveRun(groupId: string, runId: string): Promise<void> {
        const current = await this.redis.get(this.activeKey(groupId))
        if (current === runId) await this.redis.del(this.activeKey(groupId))
    }

    async abandonRun(groupId: string, runId: string): Promise<void> {
        await this.releaseActiveRun(groupId, runId)
        const owner = await this.redis.get(this.runGroupKey(runId))
        if (owner === groupId) await this.redis.del(this.runGroupKey(runId))
    }

    async isRunInGroup(groupId: string, runId: string): Promise<boolean> {
        const owner = await this.redis.get(this.runGroupKey(runId))
        if (owner) return owner === groupId
        const active = await this.redis.get(this.activeKey(groupId))
        return active === runId
    }

    async getActiveRun(groupId: string): Promise<string | null> {
        return this.redis.get(this.activeKey(groupId))
    }

    async getActiveRuns(groupIds: string[]): Promise<Map<string, string>> {
        const result = new Map<string, string>()
        if (groupIds.length === 0) return result
        const values = await this.redis.mget(groupIds.map((id) => this.activeKey(id)))
        groupIds.forEach((id, i) => {
            const v = values[i]
            if (v) result.set(id, v)
        })
        return result
    }

    async publish(runId: string, event: GroupRunEvent): Promise<void> {
        await this.redis.xadd(
            this.eventsKey(runId),
            'MAXLEN',
            '~',
            GroupRunStream.MAX_EVENTS,
            '*',
            'ev',
            JSON.stringify(event)
        )
    }

    async finalize(runId: string): Promise<void> {
        await this.redis.expire(this.eventsKey(runId), GroupRunStream.STREAM_TTL_SEC)
        await this.redis.expire(this.runGroupKey(runId), GroupRunStream.STREAM_TTL_SEC)
    }

    async *subscribe(groupId: string, runId: string): AsyncIterable<GroupRunEvent> {
        const conn = this.redis.duplicate()
        const key = this.eventsKey(runId)
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
                    GroupRunStream.BLOCK_MS,
                    'STREAMS',
                    key,
                    lastId
                )) as Array<[string, Array<[string, string[]]>]> | null
                if (!res) {
                    const active = await this.redis.get(this.activeKey(groupId))
                    if (active !== runId) return
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

    async requestAbort(runId: string): Promise<void> {
        await this.redis.publish(GroupRunStream.CONTROL_CHANNEL, runId)
    }

    onAbortRequest(handler: (runId: string) => void): void {
        this.abortHandler = handler
    }

    /** 启动时回收残留活跃轮（单实例部署）：补发 done、设 TTL、删指针。 */
    async reclaimStaleActiveRuns(): Promise<number> {
        let cursor = '0'
        let reclaimed = 0
        const pattern = 'group:*:activerun'
        do {
            const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
            cursor = next
            for (const key of keys) {
                const runId = await this.redis.get(key)
                if (runId) {
                    await this.publish(runId, {
                        type: 'done',
                        runId,
                        success: false
                    }).catch(() => undefined)
                    await this.finalize(runId).catch(() => undefined)
                }
                await this.redis.del(key)
                reclaimed++
            }
        } while (cursor !== '0')
        return reclaimed
    }

    private decode(fields: string[]): GroupRunEvent | null {
        const idx = fields.indexOf('ev')
        if (idx < 0 || idx + 1 >= fields.length) return null
        try {
            return JSON.parse(fields[idx + 1]) as GroupRunEvent
        } catch {
            return null
        }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
