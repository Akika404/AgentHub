import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { GroupSenderRole, MessageReplyRef } from '@agenthub/shared'

/** 展示层消息卡片类型 */
export type GroupMessageKind = 'text' | 'system' | 'task-list' | 'options' | 'agent-question'

/**
 * GroupMessage — 群聊展示层 presentation_log（给人看 / 审计），多发言者。
 *
 * 与"给 Agent 的结构化上下文"解耦：群聊原文默认不注入 Agent。统一承载
 * text / system / task-list / options 四种卡片，结构化字段放 `payload`（JSON）。
 */
@Entity('group_message')
export class GroupMessage {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 16 })
    kind!: GroupMessageKind

    @Column({ type: 'varchar', length: 16 })
    senderRole!: GroupSenderRole

    /** senderRole==='agent' 时为成员 Agent id；其余为 null */
    @Column({ type: 'varchar', length: 36, nullable: true })
    senderAgentId!: string | null

    /** text/system/options 的正文；task-list 为 null */
    @Column({ type: 'text', nullable: true })
    text!: string | null

    /** 结构化负载：task-list 的 {heading,tasks}；options 的 {options,answered,...}；agent-question 的 {taskId,questions,answered} */
    @Column({ type: 'json', nullable: true })
    payload!: Record<string, unknown> | null

    /** 当本条消息是对另一条消息的引用时，存被引用消息快照 {messageId,senderName,excerpt}；否则 NULL */
    @Column({ type: 'json', nullable: true })
    replyTo!: MessageReplyRef | null

    @CreateDateColumn()
    createdAt!: Date
}
