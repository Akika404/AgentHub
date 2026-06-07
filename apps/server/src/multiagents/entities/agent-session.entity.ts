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
/** 会话用途：用户显式创建的单聊 / 群聊内部成员运行会话 */
export type AgentSessionScope = 'user' | 'group'

/**
 * AgentSession — 一个单 Agent 聊天会话。
 *
 * 一个 Agent 可以被创建出多条互不影响的会话。用户显式创建的单聊 scope=user，
 * 群聊成员复用的内部运行会话 scope=group，不进入 /agent-chats 列表。
 * 每条会话拥有自己的工作目录、会话私有 home、SDK 会话句柄、合并后的
 * skills/MCP 运行配置和 UI 消息历史。
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

    /** 用户单聊 / 群聊内部成员会话；内部会话不暴露在单聊 API 中 */
    @Index()
    @Column({ type: 'varchar', length: 16, default: 'user' })
    scope!: AgentSessionScope

    /** 可选聊天标题；为空时客户端按 Agent 名称 + 创建时间展示 */
    @Column({ type: 'varchar', length: 128, nullable: true })
    title!: string | null

    /** 本聊天实际工作目录；创建聊天时可省略，由后端分配 AgentHome/TaskN */
    @Column({ type: 'varchar', length: 1024 })
    workingDirectory!: string

    /** 本聊天私有 home；用于 SDK 状态隔离，vendor 配置发现目录同步到 workingDirectory */
    @Column({ type: 'varchar', length: 1024 })
    sessionHomeDirectory!: string

    /** 合并 Agent 原配置与本聊天导入项后的有效 skills */
    @Column({ type: 'json', nullable: true })
    skills!: 'all' | string[] | null

    /** 合并 Agent 原配置与本聊天配置后的有效 MCP servers */
    @Column({ type: 'json', nullable: true })
    mcpServers!: Record<string, unknown> | null

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
