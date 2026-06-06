import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * GroupChatMember — 群成员，关联一个用户已创建的 Agent。
 *
 * 成员"干活"复用单聊的 AgentSession + turn 机制：每个成员在群内有一条可复用的
 * AgentSession（`agentSessionId`，懒创建），每次派发任务时把其 workingDirectory
 * 指向该任务的 git worktree。
 */
@Entity('group_chat_member')
export class GroupChatMember {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    agentId!: string

    /** 自由文本能力标签（如 "前端"/"后端"）；可空 */
    @Column({ type: 'varchar', length: 64, nullable: true })
    roleInGroup!: string | null

    /** 该成员在本群复用的 AgentSession id；首次派发时懒创建 */
    @Column({ type: 'varchar', length: 36, nullable: true })
    agentSessionId!: string | null

    @CreateDateColumn()
    joinedAt!: Date
}
