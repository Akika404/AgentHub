import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { basename } from 'node:path'
import { REDIS_CLIENT } from '../../../redis/redis.module.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import type { HotContext } from '../context/context-assembler.service.js'

/** 短期热上下文（Redis，带 TTL；情况 A 专用，仅承载指代解析所需最小热信息） */
export interface ShortTermBuffer {
    recentUserIntents: string[]
    recentAgentOutputs: string[]
    recentArtifacts: Array<{ path: string; version: number }>
    mentionIndex: Record<string, string>
}

export type ContinuityCase = 'A' | 'B' | 'C'

export interface ContinuityResult {
    case: ContinuityCase
    /** 目标产出物路径（重读对象） */
    targetArtifactPaths: string[]
    /** 情况 A 命中时的热上下文 */
    hotContext: HotContext | null
    /** 判不了（模糊）→ 兜底交 Orchestrator */
    needsOrchestratorJudgement: boolean
}

/** 强指代词表（命中即认为是紧接追问的强延续信号） */
const STRONG_DEIXIS = [
    '那个',
    '这个',
    '刚才',
    '刚刚',
    '你写的',
    '你刚',
    '上面',
    '上次',
    '继续',
    '接着',
    '再改',
    '再加',
    '改改',
    '它'
]

const HOT_WINDOW_SEC = 5 * 60

/**
 * ContinuityResolver — "再次修改"场景判定（轻量规则，不调 LLM）。
 *
 *   A 紧接追问：热窗口未过期 + 强指代词 → buffer 解析指代 + 重读产出物
 *   B 同产出物新修改：黑板 artifacts 命中同产出物 → 重开 + 产出物摘要 + 记忆 + 重读
 *   C 完全新任务：无匹配 → 完全重开 + 仅通用信息
 * 判不了（模糊）→ needsOrchestratorJudgement，兜底交 Orchestrator。
 */
@Injectable()
export class ContinuityResolver {
    constructor(
        @Inject(REDIS_CLIENT) private readonly redis: Redis,
        private readonly blackboard: BlackboardService
    ) {}

    private bufferKey(groupId: string, agentId: string): string {
        return `group:stb:${groupId}:${agentId}`
    }

    async resolve(groupId: string, agentId: string, text: string): Promise<ContinuityResult> {
        const buffer = await this.readBuffer(groupId, agentId)
        const hasDeixis = this.hasStrongDeixis(text)

        // 情况 A：热窗口未过期（buffer 存在即未过期，TTL 兜底）+ 强指代词
        if (buffer && hasDeixis && buffer.recentArtifacts.length > 0) {
            return {
                case: 'A',
                targetArtifactPaths: buffer.recentArtifacts.map((a) => a.path),
                hotContext: {
                    recentUserIntents: buffer.recentUserIntents,
                    recentAgentOutputs: buffer.recentAgentOutputs,
                    mentionIndex: buffer.mentionIndex
                },
                needsOrchestratorJudgement: false
            }
        }

        // 情况 B：黑板 artifacts 命中同产出物。命中多个目标时规则无法确定改谁，
        // 交给 Orchestrator 用更完整的上下文判断。
        const matched = await this.matchArtifacts(groupId, text)
        if (matched.length === 1) {
            return {
                case: 'B',
                targetArtifactPaths: matched,
                hotContext: null,
                needsOrchestratorJudgement: false
            }
        }
        if (matched.length > 1) {
            return this.needsOrchestrator('B', matched)
        }

        // 有强指代但既没有可用热 buffer，也没有明确 artifact 命中，说明"那个/刚才"
        // 无法由轻量规则落到某个产出物；按设计兜底交 Orchestrator。
        if (hasDeixis) {
            return this.needsOrchestrator('C', [])
        }

        // 情况 C：无匹配 → 全新任务，仅通用信息
        return {
            case: 'C',
            targetArtifactPaths: [],
            hotContext: null,
            needsOrchestratorJudgement: false
        }
    }

    private needsOrchestrator(
        fallbackCase: ContinuityCase,
        targetArtifactPaths: string[]
    ): ContinuityResult {
        return {
            case: fallbackCase,
            targetArtifactPaths,
            hotContext: null,
            needsOrchestratorJudgement: true
        }
    }

    hasStrongDeixis(text: string): boolean {
        return STRONG_DEIXIS.some((w) => text.includes(w))
    }

    /** 黑板产出物匹配：路径片段（含 basename）出现在文本中即视为命中。 */
    private async matchArtifacts(groupId: string, text: string): Promise<string[]> {
        const state = await this.blackboard.getState(groupId)
        const lower = text.toLowerCase()
        const matched: string[] = []
        for (const a of state.artifacts) {
            const base = basename(a.path).toLowerCase()
            const baseParts = base.split('.').filter((s) => s.length >= 3)
            const segs = a.path.toLowerCase().split(/[\\/]/).filter(Boolean)
            const tokens = [base, ...baseParts, ...segs]
            if (tokens.some((s) => s.length >= 3 && lower.includes(s))) {
                matched.push(a.path)
            }
        }
        return matched
    }

    /** 收尾写 short_term_buffer（TTL）。情况 A 保持热窗口；B/C 也写以承接下一轮。 */
    async writeBuffer(groupId: string, agentId: string, buffer: ShortTermBuffer): Promise<void> {
        await this.redis.set(
            this.bufferKey(groupId, agentId),
            JSON.stringify(buffer),
            'EX',
            HOT_WINDOW_SEC
        )
    }

    async readBuffer(groupId: string, agentId: string): Promise<ShortTermBuffer | null> {
        const raw = await this.redis.get(this.bufferKey(groupId, agentId))
        if (!raw) return null
        try {
            return JSON.parse(raw) as ShortTermBuffer
        } catch {
            return null
        }
    }
}
