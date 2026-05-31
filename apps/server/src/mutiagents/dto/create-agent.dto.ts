import { Allow, IsArray, IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'
import type { AgentPermissionMode, AgentVendor } from '../adapter/index.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
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

    @IsIn(VENDORS)
    vendor!: AgentVendor

    /** 引用的模型平台 id（platform_provider.id）；运行时据此取 baseUrl + apiKey */
    @IsString()
    @IsNotEmpty()
    platformProviderId!: string

    /** 选定的模型名，须属于所引用 Provider 的 modelList */
    @IsString()
    @IsNotEmpty()
    model!: string

    @IsString()
    @IsNotEmpty()
    workingDirectory!: string

    @IsOptional()
    @IsString()
    systemPrompt?: string

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
