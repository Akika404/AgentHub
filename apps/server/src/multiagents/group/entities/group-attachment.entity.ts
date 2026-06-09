import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * GroupAttachment — user-uploaded file staged for a group message.
 *
 * Uploads are first written under the group's excluded runtime area, then copied
 * into `attachments/<runId>/...` when a group run consumes them.
 */
@Entity('group_attachment')
export class GroupAttachment {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 255 })
    originalName!: string

    @Column({ type: 'varchar', length: 128 })
    mimeType!: string

    @Column({ type: 'int', unsigned: true })
    size!: number

    @Column({ type: 'varchar', length: 1024 })
    tempPath!: string

    @Index()
    @Column({ type: 'varchar', length: 36, nullable: true })
    runId!: string | null

    @Column({ type: 'varchar', length: 1024, nullable: true })
    workspacePath!: string | null

    @Column({ type: 'datetime', nullable: true })
    consumedAt!: Date | null

    @CreateDateColumn()
    createdAt!: Date
}
