import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { BlackboardDecisionStatus } from '@agenthub/shared'

/**
 * BlackboardDecision — 决策（带 status / supersedes / rationale）。
 *
 * 写入新决策时把 `supersedes` 指向的旧决策置为 superseded，避免新旧决策并存。
 */
@Entity('blackboard_decision')
export class BlackboardDecisionEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'text' })
    content!: string

    @Column({ type: 'text', nullable: true })
    rationale!: string | null

    @Column({ type: 'varchar', length: 16, default: 'proposed' })
    status!: BlackboardDecisionStatus

    @Column({ type: 'varchar', length: 128, nullable: true })
    scope!: string | null

    /** 取代的旧决策 id 列表 */
    @Column({ type: 'json', nullable: true })
    supersedes!: string[] | null

    @Column({ type: 'varchar', length: 36 })
    createdByAgentId!: string

    /** 'orchestrator' | agentId | userId；未批准为 null */
    @Column({ type: 'varchar', length: 64, nullable: true })
    approvedBy!: string | null

    @CreateDateColumn()
    createdAt!: Date
}
