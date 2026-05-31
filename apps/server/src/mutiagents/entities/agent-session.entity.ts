import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import type { AgentVendor } from '../adapter/index.js'

/** 会话状态：活跃 / 已暂存（从内存驱逐，可恢复）/ 已清空（句柄丢弃，下次开新会话） */
export type AgentSessionStatus = 'active' | 'suspended' | 'cleared'

/**
 * AgentSession — 一次对话的"句柄"。
 *
 * 客户端通过其 Agent（agentId）与之对话；本期为「单聊」语义：每个 Agent 懒加载/复用一条会话。
 * 会话内容由底层 SDK 落盘（Claude session 文件 / Codex thread rollout），这里只持久化恢复所需的
 * `sdkSessionId` + 状态，因而能扛进程重启（恢复 = 用 Agent 配置重建 adapter 并 resumeWith(sdkSessionId)）。
 */
@Entity('agent_session')
export class AgentSession {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 归属用户 id（逻辑外键到 user.id）；冗余存储，免 join 即可做数据隔离 */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    /** 关联的 Agent id（逻辑外键到 agent.id） */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    agentId!: string

    /** 冗余 vendor，免去重建时为取 vendor 而 join agent */
    @Column({ type: 'varchar', length: 16 })
    vendor!: AgentVendor

    /** 底层 SDK 的会话 id（Claude session UUID / Codex thread id）。清空后为 null */
    @Column({ type: 'varchar', length: 128, nullable: true })
    sdkSessionId!: string | null

    @Column({ type: 'varchar', length: 16, default: 'active' })
    status!: AgentSessionStatus

    @Column({ type: 'datetime', nullable: true })
    lastTurnAt!: Date | null

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
