import { ApiProperty } from '@nestjs/swagger'
import type { AgentCapabilities, AgentVendor } from '../adapter/index.js'
import type { AgentSessionStatus } from '../entities/agent-session.entity.js'
import type { AgentView, CreateAgentResult } from './agent-view.dto.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const STATUSES: AgentSessionStatus[] = ['active', 'suspended', 'cleared']

/**
 * 响应侧 DTO（Swagger 文档模型）。
 *
 * agent-view.dto.ts 里的 AgentView / CreateAgentResult 是 interface，编译后被
 * 擦除、运行时无元数据，Swagger 无法据其生成 schema。这里用 class 镜像同一形状
 * 并 `implements` 对应 interface —— 字段一旦与契约不符即编译报错，因此 interface
 * 仍是唯一契约，本文件只为出文档。
 */
export class AgentCapabilitiesDto implements AgentCapabilities {
    @ApiProperty({ description: '是否支持自定义 system prompt' })
    supportsSystemPrompt!: boolean

    @ApiProperty({ description: '是否支持预加载 skills' })
    supportsSkills!: boolean

    @ApiProperty({ description: '是否支持 MCP servers' })
    supportsMcp!: boolean

    @ApiProperty({ description: '是否支持按外部 sessionId 跨进程恢复' })
    supportsResumeById!: boolean
}

/** 对外返回的 Agent 视图（会话 + 档案的投影） */
export class AgentViewDto implements AgentView {
    @ApiProperty({ description: '会话 id（客户端用它对话）' })
    sessionId!: string

    @ApiProperty({ description: 'Agent 档案 id' })
    specId!: string

    @ApiProperty({ enum: VENDORS, description: '厂商' })
    vendor!: AgentVendor

    @ApiProperty({ description: '模型名' })
    model!: string

    @ApiProperty({ description: 'Agent 操作文件系统的根目录' })
    workingDirectory!: string

    @ApiProperty({ enum: STATUSES, description: '会话状态' })
    status!: AgentSessionStatus

    @ApiProperty({ type: AgentCapabilitiesDto, description: '该 vendor 的能力描述' })
    capabilities!: AgentCapabilitiesDto

    @ApiProperty({ description: '是否有进行中的底层会话（sdkSessionId 非空）' })
    hasLiveSession!: boolean

    @ApiProperty({
        type: String,
        nullable: true,
        description: '最近一轮对话时间，ISO8601；从未对话为 null'
    })
    lastTurnAt!: string | null

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string
}

/** 创建成功后的返回 */
export class CreateAgentResultDto implements CreateAgentResult {
    @ApiProperty({ description: '会话 id（客户端用它对话）' })
    sessionId!: string

    @ApiProperty({ description: 'Agent 档案 id' })
    specId!: string

    @ApiProperty({ enum: VENDORS, description: '厂商' })
    vendor!: AgentVendor

    @ApiProperty({ type: AgentCapabilitiesDto, description: '该 vendor 的能力描述' })
    capabilities!: AgentCapabilitiesDto
}

/** 删除会话的返回 */
export class DeleteAgentResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已删除' })
    deleted!: true
}
