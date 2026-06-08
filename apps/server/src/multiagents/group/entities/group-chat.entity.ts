import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import type { AgentVendor, GroupChatStatus, ProjectStatus } from '@agenthub/shared'

/**
 * GroupChat — 一个群聊：把多个已有 Agent 拉进同一会话，围绕一块黑板 + 一个共享
 * git 工作区协作，由独立内置的 Orchestrator 编排。
 *
 * 归属某个用户（`userId`，逻辑外键到 user.id）。Orchestrator 与成员 Agent 解耦，
 * 单独配置 vendor/model/provider；systemPrompt 系统内置（用户不填）。projectMeta
 * 直接挂为字段，不另建表。activeRunId 不落库，由 Redis 活跃指针提供。
 */
@Entity('group_chat')
export class GroupChat {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 归属用户 id（逻辑外键到 user.id，无 DB 约束），按它做数据隔离 */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Column({ type: 'varchar', length: 128 })
    title!: string

    @Column({ type: 'varchar', length: 16, default: 'active' })
    status!: GroupChatStatus

    /** 跨端聊天列表置顶状态 */
    @Column({ type: 'boolean', default: false })
    isPinned!: boolean

    /** 归档时间；非空表示群聊只读，不能再发起新 run */
    @Column({ type: 'datetime', nullable: true })
    archivedAt!: Date | null

    /** 共享 git 工作区根（产出物真相源；成员 worktree / SDK home 挂在其下） */
    @Column({ type: 'varchar', length: 1024 })
    workspaceDir!: string

    // —— Orchestrator 配置（独立内置角色）——
    @Column({ type: 'varchar', length: 16 })
    orchestratorVendor!: AgentVendor

    @Column({ type: 'varchar', length: 128 })
    orchestratorModel!: string

    /** Orchestrator 引用的 platform_provider.id */
    @Column({ type: 'varchar', length: 36 })
    orchestratorProviderId!: string

    /** Orchestrator SDK 会话 id；内部运行时字段，不暴露给前端 */
    @Column({ type: 'varchar', length: 128, nullable: true })
    orchestratorSessionId!: string | null

    // —— projectMeta（挂在群上，不另建表）——
    @Column({ type: 'varchar', length: 128 })
    projectName!: string

    @Column({ type: 'text', nullable: true })
    projectGoal!: string | null

    @Column({ type: 'json', nullable: true })
    projectTechStack!: string[] | null

    @Column({ type: 'varchar', length: 16, default: 'planning' })
    projectStatus!: ProjectStatus

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
