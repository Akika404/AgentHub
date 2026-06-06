import { Injectable } from '@nestjs/common'
import type { AgentMemoryItem, BlackboardArtifact, BlackboardContract } from '@agenthub/shared'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { AgentMemoryService, type MemoryScope } from '../memory/agent-memory.service.js'

export type DispatchMode = 'new_task' | 'modify_existing'

/** 任务上下文（L2，现场组装、用完即焚） */
export interface TaskContext {
    objective: string
    mode: DispatchMode
    inputs?: string[]
    constraints?: string[]
    outputSpec?: string
}

/** 情况 A 命中时附带的短期热上下文（仅承载指代解析所需的最小热信息） */
export interface HotContext {
    recentUserIntents?: string[]
    recentAgentOutputs?: string[]
    mentionIndex?: Record<string, string>
}

export interface ContextAssemblerInput {
    groupId: string
    agentId: string
    task: TaskContext
    scope: MemoryScope
    /** 目标产出物路径（read_before_edit 的对象） */
    targetArtifacts?: string[]
    hotContext?: HotContext | null
    budget?: { maxChars?: number }
}

export interface AssembledArtifactRef {
    path: string
    version: number
    loadPolicy: 'read_before_edit'
}

export interface ContextAssemblerOutput {
    /** 拼装好的成员 turn 提示词（成员自身 systemPrompt 仍为其角色定义） */
    prompt: string
    /** 注入痕迹（轻量可观测，便于调试；非正式 context_trace） */
    trace: {
        targetArtifacts: AssembledArtifactRef[]
        contracts: string[]
        memoryIds: string[]
        droppedMemoryIds: string[]
        omitted: string[]
    }
}

const DEFAULT_MAX_CHARS = 16_000

/**
 * ContextAssembler — "按需拉取"的唯一装配入口。固化检索优先级铁律：
 *   当前产出物 > 黑板契约/决策 > 任务上下文 > 私有记忆 > 历史会话摘要
 * 默认注黑板摘要（全文交 Agent 用文件工具读，load_policy=read_before_edit）；
 * memory 与黑板契约/决策冲突者丢弃并标 stale；情况 A 命中附 short_term_buffer。
 * 预算超限裁剪序：历史会话摘要 → 低优记忆 → 非目标产出物摘要
 *   （保底：system + TaskContext + 目标产出物 ref + 相关契约）。不调 LLM。
 */
@Injectable()
export class ContextAssembler {
    constructor(
        private readonly blackboard: BlackboardService,
        private readonly memory: AgentMemoryService
    ) {}

    async assemble(input: ContextAssemblerInput): Promise<ContextAssemblerOutput> {
        const maxChars = input.budget?.maxChars ?? DEFAULT_MAX_CHARS
        const state = await this.blackboard.getState(input.groupId)

        const targetPaths = new Set(input.targetArtifacts ?? [])
        const targetArtifacts = state.artifacts.filter((a) => targetPaths.has(a.path))
        const nonTargetArtifacts = state.artifacts.filter((a) => !targetPaths.has(a.path))
        const contracts = this.relevantContracts(state.contracts, targetArtifacts)

        // 记忆检索 + 与黑板冲突丢弃（记忆不对抗黑板）
        const rawMemory = await this.memory.retrieve(input.agentId, input.scope)
        const kept: AgentMemoryItem[] = []
        const dropped: AgentMemoryItem[] = []
        for (const item of rawMemory) {
            if (this.conflictsWithBlackboard(item, state.decisions, state.contracts)) {
                dropped.push(item)
                await this.memory.markStale(item.id)
            } else {
                kept.push(item)
            }
        }

        // —— 分段构建（保底段 + 可裁剪段）——
        const keepSections: string[] = []
        keepSections.push(this.renderTaskContext(input.task))
        if (targetArtifacts.length) keepSections.push(this.renderTargetArtifacts(targetArtifacts))
        if (contracts.length) keepSections.push(this.renderContracts(contracts))

        // 可裁剪段，按"越靠前越先被裁"排列：低优记忆 → 非目标产出物摘要 → 黑板决策摘要
        const droppable: Array<{ id: string; text: string }> = []
        if (kept.length) droppable.push({ id: 'memory', text: this.renderMemory(kept) })
        if (nonTargetArtifacts.length) {
            droppable.push({ id: 'other-artifacts', text: this.renderOtherArtifacts(nonTargetArtifacts) })
        }
        if (state.decisions.some((d) => d.status !== 'superseded')) {
            droppable.push({ id: 'decisions', text: this.renderDecisions(state.decisions) })
        }

        // 情况 A：附短期热上下文（高于可裁剪段，但低于保底段）
        if (input.hotContext) keepSections.push(this.renderHotContext(input.hotContext))

        const omitted: string[] = []
        const keptText = keepSections.join('\n\n')
        let total = keptText.length
        const includedDroppable: string[] = []
        // 从"最不易裁"的末尾开始纳入，预算不足时丢弃靠前（低优）的段
        for (let i = droppable.length - 1; i >= 0; i--) {
            const seg = droppable[i]
            if (total + seg.text.length + 2 <= maxChars) {
                includedDroppable.unshift(seg.text)
                total += seg.text.length + 2
            } else {
                omitted.push(seg.id)
            }
        }

        const prompt = [keptText, ...includedDroppable].filter(Boolean).join('\n\n')

        return {
            prompt,
            trace: {
                targetArtifacts: targetArtifacts.map((a) => ({
                    path: a.path,
                    version: a.version,
                    loadPolicy: 'read_before_edit'
                })),
                contracts: contracts.map((c) => c.id),
                memoryIds: kept.filter((m) => !omitted.includes('memory')).map((m) => m.id),
                droppedMemoryIds: dropped.map((m) => m.id),
                omitted
            }
        }
    }

    /** 记忆与黑板冲突：source 指向的决策已被取代/拒绝，或指向的契约已不存在。 */
    private conflictsWithBlackboard(
        item: AgentMemoryItem,
        decisions: { id: string; status: string }[],
        contracts: { id: string }[]
    ): boolean {
        if (item.source.type !== 'blackboard' || !item.source.ref) return false
        const ref = item.source.ref
        const decision = decisions.find((d) => d.id === ref)
        if (decision) return decision.status === 'superseded' || decision.status === 'rejected'
        // ref 形如 "contract:time_api" 或直接契约 key
        const contractKey = ref.startsWith('contract:') ? ref.slice('contract:'.length) : ref
        const hasContract = contracts.some((c) => c.id === contractKey)
        // 若声称来自某契约但该契约已不存在 → 视为陈旧
        return ref.startsWith('contract:') ? !hasContract : false
    }

    private relevantContracts(
        contracts: BlackboardContract[],
        targetArtifacts: BlackboardArtifact[]
    ): BlackboardContract[] {
        if (targetArtifacts.length === 0) return contracts
        const owners = new Set(targetArtifacts.map((a) => a.ownerAgentId))
        const filtered = contracts.filter(
            (c) => owners.has(c.ownerAgentId) || (c.consumers ?? []).some((id) => owners.has(id))
        )
        // 相关契约为空时退回全部契约（契约是协作关键，宁多勿漏）
        return filtered.length ? filtered : contracts
    }

    private renderTaskContext(task: TaskContext): string {
        const lines = ['# Task', `objective: ${task.objective}`, `mode: ${task.mode}`]
        if (task.inputs?.length) lines.push(`inputs:\n${task.inputs.map((i) => `- ${i}`).join('\n')}`)
        if (task.constraints?.length) {
            lines.push(`constraints:\n${task.constraints.map((c) => `- ${c}`).join('\n')}`)
        }
        if (task.outputSpec) lines.push(`output_spec: ${task.outputSpec}`)
        return lines.join('\n')
    }

    private renderTargetArtifacts(artifacts: BlackboardArtifact[]): string {
        const lines = ['# Target artifacts (read_before_edit — 用文件工具重读当前产出物再改)']
        for (const a of artifacts) {
            lines.push(`- ${a.path} (v${a.version}, ${a.status}): ${a.summary}`)
        }
        return lines.join('\n')
    }

    private renderContracts(contracts: BlackboardContract[]): string {
        const lines = ['# Shared contracts (仅 owner 可改；非 owner 触碰 approvalRequired 将被拒)']
        for (const c of contracts) {
            lines.push(
                `- ${c.id} owner=${c.ownerAgentId} approvalRequired=${c.approvalRequired}: ${JSON.stringify(c.spec)}`
            )
        }
        return lines.join('\n')
    }

    private renderDecisions(decisions: { content: string; status: string }[]): string {
        const lines = ['# Decisions']
        for (const d of decisions.filter((x) => x.status !== 'superseded')) {
            lines.push(`- [${d.status}] ${d.content}`)
        }
        return lines.join('\n')
    }

    private renderOtherArtifacts(artifacts: BlackboardArtifact[]): string {
        const lines = ['# Other artifacts (摘要参考)']
        for (const a of artifacts) lines.push(`- ${a.path}: ${a.summary}`)
        return lines.join('\n')
    }

    private renderMemory(items: AgentMemoryItem[]): string {
        const lines = ['# Your memory (private, 仅辅助；与黑板冲突以黑板为准)']
        for (const m of items) lines.push(`- [${m.type}] ${m.content}`)
        return lines.join('\n')
    }

    private renderHotContext(hot: HotContext): string {
        const lines = ['# Recent hot context (紧接追问，仅辅助指代解析)']
        if (hot.recentUserIntents?.length) {
            lines.push(`recent_user_intents: ${hot.recentUserIntents.join(' | ')}`)
        }
        if (hot.recentAgentOutputs?.length) {
            lines.push(`recent_agent_outputs: ${hot.recentAgentOutputs.join(' | ')}`)
        }
        if (hot.mentionIndex && Object.keys(hot.mentionIndex).length) {
            lines.push(`mention_index: ${JSON.stringify(hot.mentionIndex)}`)
        }
        return lines.join('\n')
    }
}
