import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'
import type { UpdateGroupMessagePayload } from '@agenthub/shared'

/** 修改群聊消息标注状态。 */
export class UpdateGroupMessageDto implements UpdateGroupMessagePayload {
    @ApiPropertyOptional({ type: Boolean, description: '是否 Pin 到当前群聊后续上下文' })
    @IsOptional()
    @IsBoolean()
    pinned?: boolean
}
