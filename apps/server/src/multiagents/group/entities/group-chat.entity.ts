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

    /** 共享 git 工作区根（产出物真相源 + worktree 基底） */
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
