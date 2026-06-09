import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn
} from 'typeorm'

/**
 * Provider 接入协议类型。
 * - openai-chat-completions：OpenAI Chat Completions（/v1/chat/completions）
 * - openai-responses：OpenAI Responses（/v1/responses）
 * - anthropic：Anthropic Messages（/v1/messages）
 *
 * 接口契约用稳定标识符；前端按需映射为「OpenAI(Chat Completions)」等展示名。
 */
export type ProviderType = 'openai-chat-completions' | 'openai-responses' | 'anthropic'

/** ProviderType 取值集，供 DTO 校验与 Swagger 枚举复用。 */
export const PROVIDER_TYPES: ProviderType[] = [
    'openai-chat-completions',
    'openai-responses',
    'anthropic'
]

/**
 * PlatformProvider — 用户自行接入的「模型平台/供应商」配置。
 *
 * 每条记录归属某个用户（`userId`，逻辑外键到 user.id），同一用户下 `platformName` 唯一。
 * `apiKey` 必须可逆使用（用于调上游），无法像密码那样哈希；这里明文存储但 `select: false`
 * 默认不随查询返回，对外视图只回掩码（见 mappers/platform-provider.mapper.ts）。
 * 与 agent_spec 的「不存 apiKey」相反——本模块的语义就是用户自带密钥，故必须落库。
 */
@Entity('platform_provider')
@Index(['userId', 'platformName'], { unique: true })
export class PlatformProvider {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    /** 归属用户 id（逻辑外键到 user.id，无 DB 约束），按它做数据隔离 */
    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    /** 平台展示名，同一用户下唯一 */
    @Column({ type: 'varchar', length: 64 })
    platformName!: string

    /** 接入协议类型 */
    @Column({ type: 'varchar', length: 32 })
    type!: ProviderType

    /** 上游 base url（如 https://api.openai.com/v1、https://api.anthropic.com） */
    @Column({ type: 'varchar', length: 512 })
    baseUrl!: string

    /** API 密钥；明文存储但默认不查出，需显式 addSelect。对外仅回掩码，绝不回明文 */
    @Column({ type: 'varchar', length: 1024, select: false })
    apiKey!: string

    /** 模型名列表；JSON 列存 string[]，可为空数组（后续补充或经 refresh 拉取） */
    @Column({ type: 'json' })
    modelList!: string[]

    /** 是否为当前用户默认 Provider；服务层保证同一用户最多一条为 true */
    @Column({ type: 'boolean', default: false })
    isDefault!: boolean

    /** 当前 Provider 作为默认项时使用的模型名 */
    @Column({ type: 'varchar', length: 128, nullable: true })
    defaultModel!: string | null

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
