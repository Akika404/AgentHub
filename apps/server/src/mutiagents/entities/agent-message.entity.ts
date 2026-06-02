import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

export type AgentMessageRole = 'user' | 'agent' | 'system'

/**
 * AgentMessage — 单 Agent 聊天 UI 历史。
 *
 * 与 AgentSession 的底层 SDK 句柄分离：这里只存主聊天区可见文本。
 * thinking/tool/todo 等运行事件只通过 SSE 实时推送，不进入历史。
 */
@Entity('agent_message')
export class AgentMessage {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    agentId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    sessionId!: string

    @Column({ type: 'varchar', length: 16 })
    role!: AgentMessageRole

    @Column({ type: 'text' })
    text!: string

    @CreateDateColumn()
    createdAt!: Date
}
