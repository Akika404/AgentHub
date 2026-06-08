import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import type { MessageReplyRef } from '@agenthub/shared'

/** 被引用消息的引用信息（镜像 shared MessageReplyRef）。 */
export class ConverseReplyRefDto implements MessageReplyRef {
    @IsString()
    @IsNotEmpty()
    messageId!: string

    @IsString()
    senderName!: string

    @IsString()
    excerpt!: string
}

/** 与 agent 对话的入参（SSE 会话） */
export class ConverseDto {
    @IsString()
    @IsNotEmpty()
    prompt!: string

    /** 引用的历史消息；服务端按 messageId 取原文拼前言发给 SDK，并随用户消息落库。 */
    @ApiPropertyOptional({ type: ConverseReplyRefDto, description: '引用的历史消息' })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => ConverseReplyRefDto)
    replyTo?: ConverseReplyRefDto
}
