import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'

/** 用户状态：活跃 / 已注销（逻辑删除，账号不可再登录） */
export type UserStatus = 'active' | 'deactivated'

/**
 * User — 平台用户。
 *
 * 登录名 `account` 唯一且不可变；`nickname`/`email`/`avatar` 为注册后可选补充的资料。
 * 密码只存 bcrypt 哈希（`passwordHash`），且 `select: false` 默认不查出，登录时显式 select。
 * 注销为逻辑删除：`status` 置 `deactivated`，记录保留，account/email 仍占用唯一索引。
 */
@Entity('user')
export class User {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 登录名，唯一不可变 */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 64 })
    account!: string

    /** bcrypt 哈希，绝不存明文；默认不随查询返回，需显式 select */
    @Column({ type: 'varchar', length: 100, select: false })
    passwordHash!: string

    /** 展示名 */
    @Column({ type: 'varchar', length: 64, nullable: true })
    nickname!: string | null

    /** 邮箱，可空且唯一（MySQL 唯一索引允许多个 NULL） */
    @Index({ unique: true })
    @Column({ type: 'varchar', length: 255, nullable: true })
    email!: string | null

    /** 头像 URL 或 data URL */
    @Column({ type: 'varchar', length: 1024, nullable: true })
    avatar!: string | null

    @Column({ type: 'varchar', length: 16, default: 'active' })
    status!: UserStatus

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
