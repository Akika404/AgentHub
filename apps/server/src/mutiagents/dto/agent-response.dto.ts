import { ApiProperty } from '@nestjs/swagger'
import type { AgentCapabilities, AgentPermissionMode, AgentVendor } from '../adapter/index.js'
import type { AgentReasoningEffort, AgentView, AgentRuntimeStatus } from './agent-view.dto.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const RUNTIME_STATUSES: AgentRuntimeStatus[] = ['active', 'suspended', 'cleared', 'none']
const PERMISSION_MODES: AgentPermissionMode[] = [
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'dontAsk',
    'auto'
]
const REASONING_EFFORTS: AgentReasoningEffort[] = [
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
]

/**
 * 响应侧 DTO（Swagger 文档模型）。
 *
 * agent-view.dto.ts 里的 AgentView 是 interface，编译后被擦除、运行时无元数据，
 * Swagger 无法据其生成 schema。这里用 class 镜像同一形状并 `implements` 对应 interface
 * —— 字段一旦与契约不符即编译报错，因此 interface 仍是唯一契约，本文件只为出文档。
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

/** 对外返回的 Agent 视图（Agent 配置 + 单聊会话运行时状态的投影） */
export class AgentViewDto implements AgentView {
    @ApiProperty({ description: 'Agent id（客户端用它对话 / 管理）' })
    id!: string

    @ApiProperty({ description: '展示名' })
    name!: string

    @ApiProperty({ enum: VENDORS, description: '厂商' })
    vendor!: AgentVendor

    @ApiProperty({ description: '引用的模型平台 id（platform_provider.id）' })
    platformProviderId!: string

    @ApiProperty({ description: '模型名' })
    model!: string

    @ApiProperty({ description: 'Agent 操作文件系统的根目录' })
    workingDirectory!: string

    @ApiProperty({ type: AgentCapabilitiesDto, description: '该 vendor 的能力描述' })
    capabilities!: AgentCapabilitiesDto

    @ApiProperty({ enum: RUNTIME_STATUSES, description: '单聊会话状态；尚未开过会话为 none' })
    status!: AgentRuntimeStatus

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

    @ApiProperty({ description: '更新时间，ISO8601' })
    updatedAt!: string

    @ApiProperty({
        type: String,
        nullable: true,
        description: '系统提示词；未配置或 vendor 不支持时为 null'
    })
    systemPrompt!: string | null

    @ApiProperty({
        nullable: true,
        oneOf: [{ type: 'string', enum: ['all'] }, { type: 'array', items: { type: 'string' } }],
        description: '"all" 或技能名数组；未配置为 null'
    })
    skills!: 'all' | string[] | null

    @ApiProperty({
        type: 'object',
        additionalProperties: true,
        nullable: true,
        description: 'MCP 服务器配置（Claude 形状）；未配置为 null'
    })
    mcpServers!: Record<string, unknown> | null

    @ApiProperty({
        type: [String],
        nullable: true,
        description: '工具白名单；未配置为 null'
    })
    allowedTools!: string[] | null

    @ApiProperty({
        enum: PERMISSION_MODES,
        nullable: true,
        description: '权限模式；未配置为 null'
    })
    permissionMode!: AgentPermissionMode | null

    @ApiProperty({
        enum: REASONING_EFFORTS,
        nullable: true,
        description: '推理 effort；未配置为 null'
    })
    reasoningEffort!: AgentReasoningEffort | null
}

/** 删除 Agent 的返回 */
export class DeleteAgentResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已删除' })
    deleted!: true
}
