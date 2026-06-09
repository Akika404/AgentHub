import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    IsArray,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested
} from 'class-validator'
import { Type } from 'class-transformer'
import type { ConverseGroupPayload, MessageReplyRef } from '@agenthub/shared'

/** 被引用消息的引用信息（镜像 shared MessageReplyRef）。 */
export class MessageReplyRefDto implements MessageReplyRef {
    @ApiProperty({ type: String, description: '被引用消息的 id' })
    @IsString()
    @IsNotEmpty()
    messageId!: string

    @ApiProperty({ type: String, description: '被引用消息发送者展示名' })
    @IsString()
    senderName!: string

    @ApiProperty({
        type: String,
        description: '被引用消息内容摘录（仅渲染用，注入以服务端原文为准）'
    })
    @IsString()
    excerpt!: string
}

/** 用户在群里发一条消息，启动一次群运行。 */
export class ConverseGroupDto implements ConverseGroupPayload {
    @ApiProperty({ type: String, description: '用户消息原文' })
    @IsString()
    text!: string

    /** 提及的成员 agentId 或 'orchestrator'；空表示交 Orchestrator 判断。 */
    @ApiPropertyOptional({
        type: [String],
        description: "提及的成员 agentId 或 'orchestrator'；空表示交 Orchestrator 判断"
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    mentions?: string[]

    /** 上传附件 id；必须属于当前用户当前群，且尚未被发送消费。 */
    @ApiPropertyOptional({
        type: [String],
        description: '上传附件 id；由 POST /group-chats/:id/attachments 返回'
    })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    attachmentIds?: string[]

    /** 引用的历史消息；服务端按 messageId 取原文注入目标成员上下文。 */
    @ApiPropertyOptional({ type: MessageReplyRefDto, description: '引用的历史消息' })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => MessageReplyRefDto)
    replyTo?: MessageReplyRefDto
}
