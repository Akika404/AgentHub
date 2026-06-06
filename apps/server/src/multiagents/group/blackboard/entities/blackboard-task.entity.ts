import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import type { BlackboardTaskStatus } from '@agenthub/shared'

/**
 * BlackboardTask — 任务图（task_graph）节点。
 *
 * Orchestrator 拆解任务后写入；本 spec 串行执行，即便有 `deps` 也按拓扑序逐个跑。
 * `seq` 保证稳定的展示与执行顺序。`runId` 记录由哪次群运行产生。
 */
@Entity('blackboard_task')
export class BlackboardTaskEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Index()
    @Column({ type: 'varchar', length: 36, nullable: true })
    runId!: string | null

    @Column({ type: 'varchar', length: 256 })
    name!: string

    /** 派给哪个成员 Agent；拆解后由 Orchestrator 指定 */
    @Column({ type: 'varchar', length: 36, nullable: true })
    agentId!: string | null

    @Column({ type: 'json', nullable: true })
    deps!: string[] | null

    @Column({ type: 'varchar', length: 16, default: 'pending' })
    status!: BlackboardTaskStatus

    @Column({ type: 'text' })
    objective!: string

    @Column({ type: 'int', default: 0 })
    seq!: number

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
