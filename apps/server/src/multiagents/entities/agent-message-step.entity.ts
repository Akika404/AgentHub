import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { AgentTodoItem, ToolCallStatus } from '../adapter/index.js'

/** 运行步骤类型。tool 行把 tool_use 与 tool_result 按 toolUseId 合并为一条 */
export type AgentMessageStepType = 'thinking' | 'progress' | 'tool' | 'todo' | 'plan'

/**
 * AgentMessageStep — 一条 agent 消息产出过程中的有序运行步骤。
 *
 * 与 AgentMessage 是一对多：一轮回复的 thinking / progress / 工具调用 / todo 事件按 seq 落库，
 * 让重开会话能复原「运行过程 · N 步」折叠条（实时流则走 SSE 即时渲染）。
 * tool 步骤同时持有完整 input 与 output。
 */
@Entity('agent_message_step')
export class AgentMessageStep {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 关联 agent_message.id（逻辑外键） */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    messageId!: string

    /** 冗余 sessionId，供按会话清理（对齐 clearChat / removeChat 的删除路径） */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    sessionId!: string

    /** 同一条消息内的步骤顺序，从 0 递增 */
    @Column({ type: 'int' })
    seq!: number

    @Column({ type: 'varchar', length: 16 })
    type!: AgentMessageStepType

    /** thinking/progress 步骤的文本；其余类型为 null */
    @Column({ type: 'text', nullable: true })
    text!: string | null

    /** tool 步骤的工具名 */
    @Column({ type: 'varchar', length: 128, nullable: true })
    toolName!: string | null

    /** tool 步骤的调用 id，用于把 tool_use 与 tool_result 配对 */
    @Column({ type: 'varchar', length: 128, nullable: true })
    toolUseId!: string | null

    /** tool 步骤的终态：started / completed / failed */
    @Column({ type: 'varchar', length: 16, nullable: true })
    toolStatus!: ToolCallStatus | null

    /** tool 完整入参 */
    @Column({ type: 'json', nullable: true })
    input!: unknown

    /** tool 完整返回 */
    @Column({ type: 'json', nullable: true })
    output!: unknown

    /** tool_result 是否报错 */
    @Column({ type: 'boolean', nullable: true })
    isError!: boolean | null

    /** todo 步骤的列表快照 */
    @Column({ type: 'json', nullable: true })
    todos!: AgentTodoItem[] | null

    @CreateDateColumn()
    createdAt!: Date
}
