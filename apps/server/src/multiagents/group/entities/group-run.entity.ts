import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { GroupRouteKind } from '@agenthub/shared'

export type GroupRunStatus = 'running' | 'done' | 'failed' | 'aborted'

/**
 * GroupRun — 一次用户消息触发的群运行（含 Orchestrator 决策 + 若干成员 turn）。
 *
 * 是"多端围观"的载体：一次群运行 = 一条 Redis Stream（沿用单聊 turn-stream 范式），
 * 这里只持久化运行的元信息用于审计与列表。
 */
@Entity('group_run')
export class GroupRun {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 16, default: 'running' })
    status!: GroupRunStatus

    @Column({ type: 'varchar', length: 16 })
    routeKind!: GroupRouteKind

    /** 触发本轮的用户消息原文 */
    @Column({ type: 'text', nullable: true })
    userText!: string | null

    @CreateDateColumn()
    createdAt!: Date

    @Column({ type: 'datetime', nullable: true })
    endedAt!: Date | null
}
