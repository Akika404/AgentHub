import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'

/**
 * BlackboardContract — 共享契约（跨 Agent 协作关键）。
 *
 * `contractKey` 是稳定业务 id（如 "time_api"），群内唯一，对外视图的 id 即它。
 * 仅 owner 可改；非 owner 触碰 `approvalRequired` 的契约会被拒绝并上报 Orchestrator。
 */
@Entity('blackboard_contract')
@Index(['groupChatId', 'contractKey'], { unique: true })
export class BlackboardContractEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    /** 稳定业务 id，例如 "time_api"；对外视图的 id */
    @Column({ type: 'varchar', length: 128 })
    contractKey!: string

    /** endpoint/returns/... 结构化字段 */
    @Column({ type: 'json' })
    spec!: Record<string, unknown>

    @Column({ type: 'varchar', length: 36 })
    ownerAgentId!: string

    @Column({ type: 'json', nullable: true })
    consumers!: string[] | null

    @Column({ type: 'boolean', default: false })
    approvalRequired!: boolean

    @Column({ type: 'int', default: 1 })
    version!: number

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
