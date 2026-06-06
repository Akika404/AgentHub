import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import type { BlackboardArtifactStatus, BlackboardArtifactType } from '@agenthub/shared'

/**
 * BlackboardArtifact — 产出物索引（结论性事实，黑板的一类对象）。
 *
 * `version` 是乐观锁基准：每次写入 +1，写时校验 based_on_version 防并发覆盖。
 * 群内同一 `path` 唯一（按 path upsert）。`summary` 供"注摘要不注全文"。
 */
@Entity('blackboard_artifact')
@Index(['groupChatId', 'path'], { unique: true })
export class BlackboardArtifactEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 16 })
    type!: BlackboardArtifactType

    @Column({ type: 'varchar', length: 512 })
    path!: string

    @Column({ type: 'varchar', length: 36 })
    ownerAgentId!: string

    @Column({ type: 'int', default: 1 })
    version!: number

    @Column({ type: 'varchar', length: 16, default: 'draft' })
    status!: BlackboardArtifactStatus

    @Column({ type: 'text' })
    summary!: string

    @Column({ type: 'varchar', length: 36 })
    updatedByAgentId!: string

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
