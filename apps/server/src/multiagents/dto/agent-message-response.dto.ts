import { ApiProperty } from '@nestjs/swagger'
import type { AgentChatMessageView } from './agent-message-view.dto.js'
import type { AgentMessageRole } from '../entities/agent-message.entity.js'

const MESSAGE_ROLES: AgentMessageRole[] = ['user', 'agent', 'system']

export class AgentChatMessageViewDto implements AgentChatMessageView {
    @ApiProperty({ description: '消息 id' })
    id!: string

    @ApiProperty({ description: '所属聊天/会话 id' })
    chatId!: string

    @ApiProperty({ description: '所属 Agent id' })
    agentId!: string

    @ApiProperty({ enum: MESSAGE_ROLES, description: '消息角色' })
    role!: AgentMessageRole

    @ApiProperty({ description: '主聊天区可见文本' })
    text!: string

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string
}
