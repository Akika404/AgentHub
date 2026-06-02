import { ApiProperty } from '@nestjs/swagger'
import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'
import { AgentCapabilitiesDto } from './agent-response.dto.js'
import type { AgentChatAgentSummary, AgentChatView } from './agent-chat-view.dto.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const SESSION_STATUSES: AgentSessionStatus[] = ['active', 'suspended', 'cleared']

export class AgentChatAgentSummaryDto implements AgentChatAgentSummary {
    @ApiProperty({ description: 'Agent id' })
    id!: string

    @ApiProperty({ description: 'Agent 展示名' })
    name!: string

    @ApiProperty({ enum: VENDORS, description: '厂商' })
    vendor!: AgentVendor

    @ApiProperty({ description: '模型名' })
    model!: string

    @ApiProperty({ type: AgentCapabilitiesDto, description: '该 vendor 的能力描述' })
    capabilities!: AgentCapabilities
}

export class AgentChatViewDto implements AgentChatView {
    @ApiProperty({ description: '聊天/会话 id' })
    id!: string

    @ApiProperty({ description: '关联 Agent id' })
    agentId!: string

    @ApiProperty({ type: AgentChatAgentSummaryDto, description: 'Agent 摘要' })
    agent!: AgentChatAgentSummaryDto

    @ApiProperty({ type: String, nullable: true, description: '用户自定义标题；未设置为 null' })
    title!: string | null

    @ApiProperty({ description: '本聊天工作目录' })
    workingDirectory!: string

    @ApiProperty({ description: '本聊天私有 home 目录' })
    sessionHomeDirectory!: string

    @ApiProperty({
        nullable: true,
        oneOf: [
            { type: 'string', enum: ['all'] },
            { type: 'array', items: { type: 'string' } }
        ],
        description: '合并后的有效 skills'
    })
    skills!: 'all' | string[] | null

    @ApiProperty({
        type: 'object',
        additionalProperties: true,
        nullable: true,
        description: '合并后的有效 MCP servers'
    })
    mcpServers!: Record<string, unknown> | null

    @ApiProperty({ enum: SESSION_STATUSES, description: '会话状态' })
    status!: AgentSessionStatus

    @ApiProperty({ description: '是否有底层 SDK 会话句柄' })
    hasLiveSession!: boolean

    @ApiProperty({ type: String, nullable: true, description: '最近一轮对话时间' })
    lastTurnAt!: string | null

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string

    @ApiProperty({ description: '更新时间，ISO8601' })
    updatedAt!: string
}

export class DeleteAgentChatResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已删除' })
    deleted!: true
}
