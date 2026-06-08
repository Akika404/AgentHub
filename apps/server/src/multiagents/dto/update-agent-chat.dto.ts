import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional } from 'class-validator'
import type { UpdateAgentChatPayload } from '@agenthub/shared'

/** 修改单聊列表状态（置顶 / 归档）。 */
export class UpdateAgentChatDto implements UpdateAgentChatPayload {
    @ApiPropertyOptional({ type: Boolean, description: '是否置顶聊天' })
    @IsOptional()
    @IsBoolean()
    isPinned?: boolean

    @ApiPropertyOptional({ type: Boolean, description: 'true 归档；false 取消归档' })
    @IsOptional()
    @IsBoolean()
    archived?: boolean
}
