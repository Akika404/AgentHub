import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'
import type { UpdateAgentChatMessagePayload } from '@agenthub/shared'

/** 修改单聊消息标注状态。 */
export class UpdateAgentMessageDto implements UpdateAgentChatMessagePayload {
    @ApiPropertyOptional({ type: Boolean, description: '是否 Pin 到当前会话后续上下文' })
    @IsOptional()
    @IsBoolean()
    pinned?: boolean
}
