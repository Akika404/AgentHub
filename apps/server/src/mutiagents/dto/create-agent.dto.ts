import {
  Allow,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator'
import type {
  AgentPermissionMode,
  AgentVendor,
} from '../adapter/index.js'

const VENDORS: AgentVendor[] = ['claude', 'codex']
const PERMISSION_MODES: AgentPermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]
const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * 创建 Agent 的入参。
 *
 * 注意：systemPrompt / skills / mcpServers 是否真正生效取决于 vendor 能力
 * （见 adapter.capabilities()）。Manager 在创建时会对不支持的组合显式报错，
 * 而非静默丢弃。
 */
export class CreateAgentDto {
  @IsIn(VENDORS)
  vendor!: AgentVendor

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

  @IsOptional()
  @IsString()
  baseUrl?: string
}
