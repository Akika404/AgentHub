import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import type { ConverseGroupPayload } from '@agenthub/shared'

/** 用户在群里发一条消息，启动一次群运行。 */
export class ConverseGroupDto implements ConverseGroupPayload {
    @ApiProperty({ type: String, description: '用户消息原文' })
    @IsString()
    @IsNotEmpty()
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
}
