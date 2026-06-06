import { ApiProperty } from '@nestjs/swagger'
import type { GroupSenderRole, OptionItem, TaskItem } from '@agenthub/shared'

const SENDER_ROLES: GroupSenderRole[] = ['user', 'orchestrator', 'agent', 'system']
const MESSAGE_KINDS = ['text', 'system', 'task-list', 'options'] as const

/**
 * 群聊展示层消息（多发言者）。运行时是 text/system/task-list/options 的判别联合；
 * 这里用一个超集 class 仅供 OpenAPI 文档（可选字段随 kind 出现）。
 */
export class GroupMessageViewDto {
    @ApiProperty({ description: '消息 id' })
    id!: string

    @ApiProperty({ description: '所属群聊 id' })
    groupChatId!: string

    @ApiProperty({ enum: MESSAGE_KINDS, description: '卡片类型' })
    kind!: (typeof MESSAGE_KINDS)[number]

    @ApiProperty({ enum: SENDER_ROLES, description: '发言者角色' })
    senderRole!: GroupSenderRole

    @ApiProperty({
        type: String,
        nullable: true,
        description: "senderRole==='agent' 时为成员 Agent id，否则 null"
    })
    senderAgentId!: string | null

    @ApiProperty({ required: false, description: 'text/system/options 的正文' })
    text?: string

    @ApiProperty({ required: false, description: 'task-list 标题' })
    heading?: string

    @ApiProperty({
        required: false,
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: 'task-list 任务项'
    })
    tasks?: TaskItem[]

    @ApiProperty({
        required: false,
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: 'options 选项'
    })
    options?: OptionItem[]

    @ApiProperty({ required: false, description: 'options 是否已作答' })
    answered?: boolean

    @ApiProperty({ required: false, description: 'options 已选项 id' })
    answeredOptionId?: string

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string
}
