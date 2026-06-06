import {
    Allow,
    IsArray,
    IsIn,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    MaxLength
} from 'class-validator'
import type { AgentPermissionMode, AgentVendor } from '../adapter/index.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const AVATAR_MAX_LENGTH = 256 * 1024 // 256 KiB compact data URL
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const PERMISSION_MODES: AgentPermissionMode[] = [
    'default',
    'acceptEdits',
    'bypassPermissions',
    'plan',
    'dontAsk',
    'auto'
]
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 修改 Agent 的入参（部分更新）。
 *
 * 所有字段可选，只更新传入的字段。可空配置字段传 null 表示清空；
 * skillSourceDirectories 传入时会额外导入到 Agent 私有 skills 目录。
 */
export class UpdateAgentDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    name?: string

    @IsOptional()
    @IsString()
    @MaxLength(AVATAR_MAX_LENGTH)
    avatar?: string | null

    @IsOptional()
    @IsString()
    @Matches(HEX_COLOR_RE)
    color?: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    capabilitySummary?: string | null

    @IsOptional()
    @IsIn(VENDORS)
    vendor?: AgentVendor

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    platformProviderId?: string

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    model?: string

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    workingDirectory?: string

    @IsOptional()
    @IsString()
    systemPrompt?: string | null

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skillSourceDirectories?: string[]

    /** "all"、技能名数组或 null。联合类型用 @Allow 放行，由 Manager 校验语义 */
    @IsOptional()
    @Allow()
    skills?: 'all' | string[] | null

    @IsOptional()
    @IsObject()
    mcpServers?: Record<string, unknown> | null

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allowedTools?: string[] | null

    @IsOptional()
    @IsIn(PERMISSION_MODES)
    permissionMode?: AgentPermissionMode | null

    @IsOptional()
    @IsIn(REASONING_EFFORTS)
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null
}
