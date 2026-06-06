import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { BlackboardUpdateKind, BlackboardUpdateOp } from '@agenthub/shared'

/**
 * BlackboardEvent — 黑板事实变更事件流（append-only，审计 / 调试）。
 *
 * 每次黑板状态变更都追加一条；同时作为运行围观时 `blackboard_update` 事件的来源。
 */
@Entity('blackboard_event')
export class BlackboardEventEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 16 })
    kind!: BlackboardUpdateKind

    /** 受影响黑板对象的 id */
    @Column({ type: 'varchar', length: 128 })
    targetId!: string

    @Column({ type: 'varchar', length: 16 })
    op!: BlackboardUpdateOp

    @Column({ type: 'text' })
    summary!: string

    /** 引发变更的 Agent；系统/Orchestrator 驱动为 null */
    @Column({ type: 'varchar', length: 36, nullable: true })
    actorAgentId!: string | null

    @CreateDateColumn()
    createdAt!: Date
}
