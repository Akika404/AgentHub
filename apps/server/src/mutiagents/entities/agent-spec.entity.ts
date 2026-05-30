import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type {
  AgentPermissionMode,
  AgentVendor,
} from '../adapter/index.js'

/**
 * AgentSpec — 一个虚拟员工的"档案/配方"。
 *
 * 持久化的是重建一个 adapter 所需的不变配置，不包含会话内容，也**不存 apiKey**
 * （密钥在重建时从 ConfigService/env 注入）。一份 spec 可被多个 session 复用。
 */
@Entity('agent_spec')
export class AgentSpec {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Column({ type: 'varchar', length: 16 })
  vendor!: AgentVendor

  @Column({ type: 'varchar', length: 128 })
  model!: string

  @Column({ type: 'varchar', length: 1024 })
  workingDirectory!: string

  @Column({ type: 'text', nullable: true })
  systemPrompt!: string | null

  /** "all" 或技能名数组；JSON 列存储 */
  @Column({ type: 'json', nullable: true })
  skills!: 'all' | string[] | null

  /** MCP 服务器配置（Claude 形状的 Record<string, McpServerConfig>） */
  @Column({ type: 'json', nullable: true })
  mcpServers!: Record<string, unknown> | null

  /** 工具白名单；为空时 adapter 用各自默认集合 */
  @Column({ type: 'json', nullable: true })
  allowedTools!: string[] | null

  @Column({ type: 'varchar', length: 32, nullable: true })
  permissionMode!: AgentPermissionMode | null

  @Column({ type: 'varchar', length: 16, nullable: true })
  reasoningEffort!: string | null

  @Column({ type: 'varchar', length: 512, nullable: true })
  baseUrl!: string | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
