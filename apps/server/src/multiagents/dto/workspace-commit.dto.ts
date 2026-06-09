import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'
import type { WorkspaceCommitPayload } from '@agenthub/shared'

export class WorkspaceCommitDto implements WorkspaceCommitPayload {
    @ApiPropertyOptional({
        type: String,
        maxLength: 160,
        description: '提交信息；未传时使用默认提交信息'
    })
    @IsOptional()
    @IsString()
    @MaxLength(160)
    message?: string
}
