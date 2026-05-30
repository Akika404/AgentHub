import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm'
import type { AgentVendor } from '../adapter/index.js'

/** 会话状态：活跃 / 已暂存（从内存驱逐，可恢复）/ 已清空（句柄丢弃，下次开新会话） */
export type AgentSessionStatus = 'active' | 'suspended' | 'cleared'

/**
 * AgentSession — 一次对话的"句柄"。
 *
 * 客户端用 `id` 与某个 agent 对话。会话内容由底层 SDK 落盘（Claude session 文件 /
 * Codex thread rollout），这里只持久化恢复所需的 `sdkSessionId` + 状态，
 * 因而能扛进程重启（恢复 = 用 spec 重建 adapter 并 resumeWith(sdkSessionId)）。
 */
@Entity('agent_session')
export class AgentSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string

  @Index()
  @Column({ type: 'uuid' })
  specId!: string

  /** 冗余 vendor，免去重建时为取 vendor 而 join spec */
  @Column({ type: 'varchar', length: 16 })
  vendor!: AgentVendor

  /** 底层 SDK 的会话 id（Claude session UUID / Codex thread id）。清空后为 null */
  @Column({ type: 'varchar', length: 128, nullable: true })
  sdkSessionId!: string | null

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: AgentSessionStatus

  @Column({ type: 'datetime', nullable: true })
  lastTurnAt!: Date | null

  @CreateDateColumn()
  createdAt!: Date

  @UpdateDateColumn()
  updatedAt!: Date
}
