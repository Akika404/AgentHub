import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { AgentMemoryItem, AgentMemorySourceType, AgentMemoryType } from '@agenthub/shared'
import { AgentMemoryItemEntity } from './entities/agent-memory-item.entity.js'
import { toAgentMemoryView } from '../mappers/agent-memory.mapper.js'

export interface MemoryScope {
    project: string
    module?: string | null
}

export interface MemoryCandidate {
    content: string
    type: AgentMemoryType
    scope: MemoryScope
    source: { type: AgentMemorySourceType; ref?: string | null }
}

/**
 * AgentMemoryService — 某 Agent 跨任务私有记忆的读写。
 *
 * MVP 仅做轻量治理：按 scope 检索 active 记忆 + 写入前轻量去重。与黑板对齐的
 * stale 化（markStaleByContract）本轮留空实现，P1 接 MemoryManager。
 * 记忆不对抗黑板：检索结果交由 ContextAssembler 做冲突丢弃。
 */
@Injectable()
export class AgentMemoryService {
    constructor(
        @InjectRepository(AgentMemoryItemEntity)
        private readonly memoryRepo: Repository<AgentMemoryItemEntity>
    ) {}

    /** 按 (agent, scope) 检索 active 记忆。module 命中精确模块或通用（module=null）。 */
    async retrieve(agentId: string, scope: MemoryScope): Promise<AgentMemoryItem[]> {
        const rows = await this.memoryRepo.find({
            where: { agentId, scopeProject: scope.project, status: 'active' },
            order: { lastUsedAt: 'DESC', createdAt: 'DESC' }
        })
        const wantModule = scope.module ?? null
        const filtered = rows.filter(
            (r) => r.scopeModule === null || wantModule === null || r.scopeModule === wantModule
        )
        return filtered.map(toAgentMemoryView)
    }

    /** 写入候选记忆：同 (agent, project) 下近似 content 已存在则跳过（轻量去重）。 */
    async writeCandidate(
        agentId: string,
        userId: string,
        candidate: MemoryCandidate
    ): Promise<AgentMemoryItem | null> {
        const normalized = this.normalize(candidate.content)
        if (!normalized) return null

        const existing = await this.memoryRepo.find({
            where: { agentId, scopeProject: candidate.scope.project, status: 'active' }
        })
        const dup = existing.some((e) => this.normalize(e.content) === normalized)
        if (dup) return null

        const saved = await this.memoryRepo.save(
            this.memoryRepo.create({
                userId,
                agentId,
                scopeProject: candidate.scope.project,
                scopeModule: candidate.scope.module ?? null,
                content: candidate.content.trim(),
                type: candidate.type,
                sourceType: candidate.source.type,
                sourceRef: candidate.source.ref ?? null,
                status: 'active',
                lastUsedAt: null
            })
        )
        return toAgentMemoryView(saved)
    }

    /**
     * 预留：契约变更时把相关记忆置 stale（P1 接 MemoryManager）。
     * 本轮 no-op，签名先就位以免后续改动扩散。
     */
    async markStaleByContract(_groupId: string, _contractKey: string): Promise<void> {
        // intentionally empty in MVP
    }

    /** 把单条记忆置 stale（ContextAssembler 检测到与黑板冲突时调用）。 */
    async markStale(itemId: string): Promise<void> {
        await this.memoryRepo.update({ id: itemId }, { status: 'stale' })
    }

    private normalize(content: string): string {
        return content.trim().toLowerCase().replace(/\s+/g, ' ')
    }
}
