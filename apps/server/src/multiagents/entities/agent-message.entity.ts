import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { MessageReplyRef } from '@agenthub/shared'

export type AgentMessageRole = 'user' | 'agent' | 'system'

/**
 * AgentMessage — 单 Agent 聊天 UI 历史。
 *
 * 与 AgentSession 的底层 SDK 句柄分离：这里只存主聊天区可见文本。
 * thinking/progress/tool/todo 等运行事件按一对多落到 AgentMessageStep，重开会话可复原运行过程。
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

    /** 当本条 user 消息是对另一条消息的引用时，存被引用消息快照 {messageId,senderName,excerpt}；否则 NULL */
    @Column({ type: 'json', nullable: true })
    replyTo!: MessageReplyRef | null

    @CreateDateColumn()
    createdAt!: Date
}
