import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { AgentMemoryStatus, AgentMemoryType, AgentMemorySourceType } from '@agenthub/shared'

/**
 * AgentMemoryItem — 某 Agent 跨任务私有记忆（带 scope / source / status）。
 *
 * 检索时按 scope 过滤；与黑板契约/决策冲突者由 ContextAssembler 丢弃并标 stale
 * （记忆不对抗黑板）。`scopeProject` 即所属群聊 id（项目）。
 */
@Entity('agent_memory_item')
export class AgentMemoryItemEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    agentId!: string

    /** 作用域 project（= 群聊 id），避免跨项目污染 */
    @Index()
    @Column({ type: 'varchar', length: 64 })
    scopeProject!: string

    @Column({ type: 'varchar', length: 128, nullable: true })
    scopeModule!: string | null

    @Column({ type: 'text' })
    content!: string

    @Column({ type: 'varchar', length: 32 })
    type!: AgentMemoryType

    @Column({ type: 'varchar', length: 16 })
    sourceType!: AgentMemorySourceType

    @Column({ type: 'varchar', length: 256, nullable: true })
    sourceRef!: string | null

    @Column({ type: 'varchar', length: 16, default: 'active' })
    status!: AgentMemoryStatus

    @CreateDateColumn()
    createdAt!: Date

    @Column({ type: 'datetime', nullable: true })
    lastUsedAt!: Date | null
}
