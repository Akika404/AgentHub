import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'
import type { AgentPermissionMode, AgentVendor } from '../adapter/index.js'

/**
 * Agent — 用户创建的一个虚拟员工（持久化配置，进入该用户的 AgentList）。
 *
 * 归属某个用户（`userId`，逻辑外键到 user.id），按它做数据隔离。配置在创建时即确定：
 * vendor、引用的 Provider（`platformProviderId`）+ 选定 model、Agent 私有目录、工作目录、systemPrompt、
 * skills、mcp、tools 等。**不存 apiKey / baseUrl**——运行时按 `platformProviderId` 从
 * platform_provider 取（见 PlatformProviderService.resolveRuntimeConfig）。
 * 一个 Agent 可被多个会话（agent_session）复用。
 */
@Entity('agent')
export class Agent {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 归属用户 id（逻辑外键到 user.id，无 DB 约束），按它做数据隔离 */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    /** 展示名，用于在 AgentList / 群聊里区分多个 Agent（同一用户下不强制唯一） */
    @Column({ type: 'varchar', length: 64 })
    name!: string

    /** 头像 URL 或压缩后的 data URL；为空时前端用 color + name 前两个字生成头像 */
    @Column({ type: 'mediumtext', nullable: true })
    avatar!: string | null

    /** 颜色标识，用于默认头像与列表标记 */
    @Column({ type: 'varchar', length: 7, default: '#3370ff' })
    color!: string

    @Column({ type: 'varchar', length: 16 })
    vendor!: AgentVendor

    /** 引用的模型平台 id（逻辑外键到 platform_provider.id）；运行时据此取 baseUrl + apiKey */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    platformProviderId!: string

    /** 选定的模型名，取自所引用 Provider 的 modelList */
    @Column({ type: 'varchar', length: 128 })
    model!: string

    /** Agent 私有持久目录；存放其独立的 .claude/skills 等配置。 */
    @Column({ type: 'varchar', length: 1024 })
    agentHomeDirectory!: string

    @Column({ type: 'varchar', length: 1024 })
    workingDirectory!: string

    @Column({ type: 'text', nullable: true })
    systemPrompt!: string | null

    /** "all" 或技能名数组；JSON 列存储 */
    @Column({ type: 'json', nullable: true })
    skills!: 'all' | string[] | null

    /** MCP 服务器配置（Claude 形状的 Record<string, McpServerConfig>） */
    @Column({ type: 'json', nullable: true })
    mcpServers!: Record<string, unknown> | null

    /** 工具白名单；为空时 adapter 用各自默认集合 */
    @Column({ type: 'json', nullable: true })
    allowedTools!: string[] | null

    @Column({ type: 'varchar', length: 32, nullable: true })
    permissionMode!: AgentPermissionMode | null

    @Column({ type: 'varchar', length: 16, nullable: true })
    reasoningEffort!: string | null

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
