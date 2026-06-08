import { Type } from 'class-transformer'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import type { UpdateGroupChatPayload } from '@agenthub/shared'
import { ProjectMetaInputDto } from './create-group-chat.dto.js'

/** 修改群聊（最小实现：改标题 / 改 projectMeta / 加成员）。 */
export class UpdateGroupChatDto implements UpdateGroupChatPayload {
    @ApiPropertyOptional({ type: String, description: '群标题' })
    @IsOptional()
    @IsString()
    title?: string

    @ApiPropertyOptional({ type: ProjectMetaInputDto, description: '项目元信息' })
    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => ProjectMetaInputDto)
    projectMeta?: ProjectMetaInputDto

    @ApiPropertyOptional({ type: [String], description: '要追加的成员 Agent id 列表' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    addMemberAgentIds?: string[]

    @ApiPropertyOptional({ type: Boolean, description: '是否置顶群聊' })
    @IsOptional()
    @IsBoolean()
    isPinned?: boolean

    @ApiPropertyOptional({ type: Boolean, description: 'true 归档；false 取消归档' })
    @IsOptional()
    @IsBoolean()
    archived?: boolean
}
