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
import type { AgentExecutionMode } from '@agenthub/shared'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const EXECUTION_MODES: AgentExecutionMode[] = ['server', 'local']
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
 * 创建 Agent 的入参。
 *
 * base_url / api_key 不在这里传：由 `platformProviderId` 引用用户自建的 Provider，
 * 运行时从 platform-provider 服务取出。model 须取自该 Provider 的 modelList。
 *
 * 注意：systemPrompt / skills / mcpServers 是否真正生效取决于 vendor 能力
 * （见 adapter.capabilities()）。Manager 在创建时会对不支持的组合、vendor 与
 * Provider 类型不兼容、model 不在 Provider modelList 等情况显式报错，而非静默丢弃。
 */
export class CreateAgentDto {
    /** 展示名，用于在 AgentList / 群聊里区分多个 Agent */
    @IsString()
    @IsNotEmpty()
    name!: string

    /** 头像 URL / 压缩后的 data URL；不传或传 null 时使用颜色 + 名称生成默认头像 */
    @IsOptional()
    @IsString()
    @MaxLength(AVATAR_MAX_LENGTH)
    avatar?: string | null

    /** 默认头像和列表标识色；不传时使用产品默认蓝色 */
    @IsOptional()
    @IsString()
    @Matches(HEX_COLOR_RE)
    color?: string

    /** 简短能力摘要，用于群聊 Orchestrator 判断该 Agent 擅长什么；创建时必填 */
    @IsString()
    @IsNotEmpty()
    @MaxLength(1000)
    capabilitySummary!: string

    @IsIn(VENDORS)
    vendor!: AgentVendor

    /**
     * 执行位置；省略时默认 server（保持既有行为）。
     * local 模式下 Agent 接入用户本机的 Claude Code / Codex，platformProviderId 省略，
     * workingDirectory 是用户本机绝对路径。
     */
    @IsOptional()
    @IsIn(EXECUTION_MODES)
    executionMode?: AgentExecutionMode

    /**
     * 引用的模型平台 id（platform_provider.id）；运行时据此取 baseUrl + apiKey。
     * server 模式必填；local 模式省略（语义校验在 AgentPolicyService）。
     */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    platformProviderId?: string

    /** 选定的模型名，须属于所引用 Provider 的 modelList */
    @IsString()
    @IsNotEmpty()
    model!: string

    @IsString()
    @IsNotEmpty()
    workingDirectory!: string

    /** Agent 私有持久目录；不传时后端分配到当前用户 agent_home/<agentId> */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    agentHomeDirectory?: string

    @IsOptional()
    @IsString()
    systemPrompt?: string

    /**
     * 待导入的服务器 Skill 文件夹路径。每个路径可以是单个含 SKILL.md 的 skill 目录，
     * 也可以是包含多个 skill 子目录的 skills 根目录；导入后会复制到当前 vendor 的 skills 目录。
     */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skillSourceDirectories?: string[]

    /** "all" 或技能名数组。形状为联合类型，用 @Allow 放行白名单，由 Manager 校验语义 */
    @IsOptional()
    @Allow()
    skills?: 'all' | string[]

    @IsOptional()
    @IsObject()
    mcpServers?: Record<string, unknown>

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    allowedTools?: string[]

    @IsOptional()
    @IsIn(PERMISSION_MODES)
    permissionMode?: AgentPermissionMode

    @IsOptional()
    @IsIn(REASONING_EFFORTS)
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}
