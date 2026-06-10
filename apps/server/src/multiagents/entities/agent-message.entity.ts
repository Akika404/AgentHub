import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { MessageReplyRef, BlackboardArtifact, DeployManifest } from '@agenthub/shared'

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

    /** 本轮 agent run 产出/改动文件的快照(从 turn 起止 diff 增量推导);仅 agent 消息可能非空 */
    @Column({ type: 'json', nullable: true })
    artifacts!: BlackboardArtifact[] | null

    /** 本轮可呈现交付物的 static 预览清单;无可呈现交付物时为 NULL */
    @Column({ type: 'json', nullable: true })
    deployManifest!: DeployManifest | null

    @Column({ type: 'boolean', default: false })
    pinned!: boolean

    @CreateDateColumn()
    createdAt!: Date
}
