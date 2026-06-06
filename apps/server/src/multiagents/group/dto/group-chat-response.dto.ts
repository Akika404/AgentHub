import { ApiProperty } from '@nestjs/swagger'
import type {
    AgentCapabilities,
    AgentVendor,
    GroupChatStatus,
    GroupChatView,
    GroupMemberView,
    OrchestratorConfigView,
    ProjectMeta,
    ProjectStatus
} from '@agenthub/shared'
import { AgentCapabilitiesDto } from '../../dto/agent-response.dto.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const GROUP_STATUSES: GroupChatStatus[] = ['active', 'archived']
const PROJECT_STATUSES: ProjectStatus[] = ['planning', 'designing', 'development', 'done']

export class OrchestratorConfigViewDto implements OrchestratorConfigView {
    @ApiProperty({ enum: VENDORS, description: 'Orchestrator 厂商（与成员解耦）' })
    vendor!: AgentVendor

    @ApiProperty({ description: 'Orchestrator 模型名' })
    model!: string

    @ApiProperty({ description: '引用的 platform_provider.id' })
    providerId!: string
}

export class GroupMemberViewDto implements GroupMemberView {
    @ApiProperty({ description: '成员 Agent id' })
    agentId!: string

    @ApiProperty({ description: '成员展示名' })
    name!: string

    @ApiProperty({ type: String, nullable: true, description: '头像；为空回退到首字母头像' })
    avatar!: string | null

    @ApiProperty({ example: '#3370ff', description: '默认头像 / 标记色' })
    color!: string

    @ApiProperty({ enum: VENDORS, description: '厂商' })
    vendor!: AgentVendor

    @ApiProperty({ type: AgentCapabilitiesDto, description: '能力描述' })
    capabilities!: AgentCapabilities

    @ApiProperty({ type: String, nullable: true, description: '群内角色标签（如 前端/后端）' })
    roleInGroup!: string | null
}

export class ProjectMetaDto implements ProjectMeta {
    @ApiProperty({ description: '项目名' })
    name!: string

    @ApiProperty({ type: String, nullable: true, description: '项目总目标' })
    goal!: string | null

    @ApiProperty({ type: [String], description: '技术栈' })
    techStack!: string[]

    @ApiProperty({ enum: PROJECT_STATUSES, description: '项目阶段' })
    status!: ProjectStatus
}

export class GroupChatViewDto implements GroupChatView {
    @ApiProperty({ description: '群聊 id' })
    id!: string

    @ApiProperty({ description: '群标题' })
    title!: string

    @ApiProperty({ enum: GROUP_STATUSES, description: '群状态' })
    status!: GroupChatStatus

    @ApiProperty({ description: '共享 git 工作区根目录' })
    workspaceDir!: string

    @ApiProperty({ type: OrchestratorConfigViewDto, description: '独立 Orchestrator 配置' })
    orchestrator!: OrchestratorConfigViewDto

    @ApiProperty({ type: [GroupMemberViewDto], description: '群成员' })
    members!: GroupMemberViewDto[]

    @ApiProperty({ type: ProjectMetaDto, description: '项目元信息' })
    projectMeta!: ProjectMetaDto

    @ApiProperty({
        type: String,
        nullable: true,
        description: '进行中的群运行 id；空闲为 null。前端据此订阅进行中运行'
    })
    activeRunId!: string | null

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string

    @ApiProperty({ description: '更新时间，ISO8601' })
    updatedAt!: string
}

export class StartGroupRunResultDto {
    @ApiProperty({ description: '新启动的群运行 id；订阅其事件流观看进度' })
    runId!: string
}

export class DeleteGroupChatResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已删除' })
    deleted!: true
}

export class AbortGroupRunResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已请求中止' })
    aborted!: true
}
