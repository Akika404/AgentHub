import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsInt, IsOptional, IsString, Min } from 'class-validator'
import type { ArtifactContentUpdatePayload } from '@agenthub/shared'

/** Replace editable artifact source content. */
export class ArtifactContentUpdateDto implements ArtifactContentUpdatePayload {
    @ApiProperty({ type: String, description: 'UTF-8 text/HTML source content to write back' })
    @IsString()
    content!: string

    @ApiPropertyOptional({
        type: Number,
        description: 'Optional blackboard artifact version baseline for conflict detection'
    })
    @IsOptional()
    @IsInt()
    @Min(1)
    baseVersion?: number
}
