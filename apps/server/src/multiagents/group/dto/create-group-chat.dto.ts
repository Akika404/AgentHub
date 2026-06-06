import { Type } from 'class-transformer'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import {
    ArrayNotEmpty,
    IsArray,
    IsIn,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested
} from 'class-validator'
import type {
    AgentVendor,
    CreateGroupChatPayload,
    OrchestratorConfigInput,
    ProjectMetaInput,
    ProjectStatus
} from '@agenthub/shared'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const PROJECT_STATUSES: ProjectStatus[] = ['planning', 'designing', 'development', 'done']

export class OrchestratorConfigInputDto implements OrchestratorConfigInput {
    @ApiProperty({ enum: VENDORS, description: 'Orchestrator 厂商' })
    @IsIn(VENDORS)
    vendor!: AgentVendor

    @ApiProperty({ type: String, description: 'Orchestrator 模型名' })
    @IsString()
    @IsNotEmpty()
    model!: string

    @ApiProperty({ type: String, description: '引用的 platform_provider.id' })
    @IsString()
    @IsNotEmpty()
    providerId!: string
}

export class ProjectMetaInputDto implements ProjectMetaInput {
    @ApiProperty({ type: String, description: '项目名' })
    @IsString()
    @IsNotEmpty()
    name!: string

    @ApiPropertyOptional({ type: String, nullable: true, description: '项目总目标' })
    @IsOptional()
    @IsString()
    goal?: string | null

    @ApiPropertyOptional({ type: [String], description: '技术栈' })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    techStack?: string[]

    @ApiPropertyOptional({ enum: PROJECT_STATUSES, description: '项目阶段' })
    @IsOptional()
    @IsIn(PROJECT_STATUSES)
    status?: ProjectStatus
}

/** 创建群聊：成员 + 独立 Orchestrator 配置 + 项目元信息（后端 git init 共享工作区）。 */
export class CreateGroupChatDto implements CreateGroupChatPayload {
    @ApiProperty({ type: String, description: '群标题' })
    @IsString()
    @IsNotEmpty()
    title!: string

    @ApiProperty({ type: [String], description: '成员 Agent id 列表' })
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    memberAgentIds!: string[]

    @ApiProperty({ type: OrchestratorConfigInputDto, description: '独立 Orchestrator 配置' })
    @IsObject()
    @ValidateNested()
    @Type(() => OrchestratorConfigInputDto)
    orchestrator!: OrchestratorConfigInputDto

    @ApiProperty({ type: ProjectMetaInputDto, description: '项目元信息' })
    @IsObject()
    @ValidateNested()
    @Type(() => ProjectMetaInputDto)
    projectMeta!: ProjectMetaInputDto

    @ApiPropertyOptional({
        type: String,
        description: '共享 git 工作区目录；传入时优先使用，未传时后端分配'
    })
    @IsOptional()
    @IsString()
    workspaceDir?: string
}
