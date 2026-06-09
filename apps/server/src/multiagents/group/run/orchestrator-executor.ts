import { Injectable } from '@nestjs/common'
import type { BlackboardTaskNode, GroupRouteKind, ProjectStatus } from '@agenthub/shared'
import {
    createAgent,
    type AgentAdapter,
    type AgentAdapterConfig,
    type AgentOutputSchema
} from '../../adapter/index.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { BusinessException } from '../../../common/index.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

/** DI token：可注入的编排计划生成器 */
export const ORCHESTRATOR_PLANNER = Symbol('ORCHESTRATOR_PLANNER')

/** Orchestrator 的"项目控制面板"上下文（不吃全量历史，防上下文黑洞） */
export interface OrchestratorContext {
    projectGoal: string | null
    blackboardSummary: string
    pinnedMessages: string
    recentUserIntents: string[]
    memberStatus: Array<{
        agentId: string
        name: string
        roleInGroup: string | null
        capabilitySummary: string | null
    }>
    activeTaskGraph: BlackboardTaskNode[]
}

export interface PlanTask {
    /** planner 本地 key（解析 deps 用） */
    key: string
    name: string
    /** 指派给的成员 Agent id */
    agentId: string
    deps: string[]
    objective: string
}

export interface PlanMemberTurn {
    /** 要真实调用的成员 Agent id。 */
    agentId: string
    /** 给该成员的轻量聊天指令；不会创建黑板任务或工作区产出。 */
    instruction: string
}

export interface OrchestratorDecisionUpdate {
    content: string
    rationale?: string | null
    scope?: string | null
}

export interface OrchestratorContextUpdates {
    projectName?: string
    projectGoal?: string | null
    projectTechStack?: string[]
    projectStatus?: ProjectStatus
    decisions?: OrchestratorDecisionUpdate[]
}

export interface OrchestratorDecision {
    /** 空数组表示只需要 Orchestrator 回复，不应创建黑板任务或派发成员。 */
    tasks: PlanTask[]
    /** 给用户的开场说明（可空） */
    note?: string
    /** SDK 实际产出的用户可见回复；用于保留澄清反问的完整自然语言正文。 */
    displayText?: string
    /** 真实成员轻量聊天 turn；不写黑板 task，不走 worktree/report/diff。 */
    memberTurns?: PlanMemberTurn[]
    /** 从对话中沉淀出的项目状态/用户选择，由服务端写回 projectMeta/blackboard。 */
    contextUpdates?: OrchestratorContextUpdates
    /** 本轮结束后的 Orchestrator SDK 会话 id；内部字段，不暴露给前端。 */
    orchestratorSessionId?: string | null
}

export interface DecisionRequest {
    group: GroupChat
    userId: string
    userText: string
    routeKind: GroupRouteKind
    mentionedAgentIds: string[]
    context: OrchestratorContext
}

export interface OrchestratorExecutor {
    decide(req: DecisionRequest): Promise<OrchestratorDecision>
}

interface OrchestratorRunResult {
    text: string
    success: boolean
    error?: string
    structuredOutput?: unknown
    sessionId?: string | null
}

/**
 * 系统内置编排提示词（用户不填）。要求 Orchestrator 仅输出结构化 JSON 计划。
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator（编排者），群里的一个持续参与者。
<你的职责>
结合上下文理解用户意图、判断复杂度，决定本轮如何回应——直接回复、请成员轻量发言，或把任务拆解并指派给最合适的成员 Agent。
</你的职责>

---

# 连续对话 | **重要**
- 你拥有跨轮的连续会话上下文。用户的简短回复（如“网页版吧”“可以”“第二个”“就这样”）通常是对你上一轮提问/澄清的回答，必须结合上文理解，不要当成孤立的新请求。
- 结合“项目目标 / 黑板摘要 / 进行中的任务 / 已确认决策”判断当前所处阶段，避免重复追问已确认的事实。

# 三种输出模式（互斥，本轮只能选其一）
1. 直接回复（noop）：问候、感谢、闲聊、状态询问、对你提问的澄清或方案讨论等，无需成员执行工具或产出文件——返回 tasks:[]，用 note 以 Orchestrator 身份给出完整自然语言回复。note 即用户看到的正文，可以是多句，不必压缩成一句。
2. 成员轻量发言（memberTurns）：用户要某些成员以其角色打招呼/自我介绍/表达观点，或解答一个无需读写文件、无需工具的问题——返回 tasks:[] + memberTurns，让成员真实轻量回复；note 用一句话说明你为何这样安排。
3. 任务派发（tasks）：用户要求创建/修改文件、实现功能、产出文档、执行命令、探索/检查/读取工作区，或任何需要工具或可交付产出的事项——返回 tasks。
  > 在给成员派发任务的时候，**必须明确写出**该成员的**角色与任务**，以及**任务执行的边界**，避免成员做了不符合他自己角色的事情。

# 判定规则
- 你绝不亲自写代码或产出物，也绝不自己调用工具读写文件；凡需这些，一律拆成 task 派给成员。
- 用户要求“探索/检查/读取/查看工作区”，或在你说明要探索/执行后继续催促“那你探索啊/继续/开始做”——必须创建成员 task，不要当成澄清或 noop，也不要自己尝试调用工具。
- 一个问题若需要读取文件、检查工作区或形成可交付回答 → 用 tasks；若只需角色判断、方案建议、信息整理且无需工具与文件 → 用 memberTurns。
- 不允许代替成员 Agent 发言：成员身份的消息只能来自真实派发并完成的成员 turn。
- 面向黑板协作，不臆造未提供的事实；只能指派给给定的成员 Agent（用其 agentId）。

# 路由来源 routeKind 与被提及成员
- direct_single：用户点名了单个成员，通常应围绕该成员安排。
- multi：用户点名了多个成员，通常给每个被提及成员各安排一个 task（或 memberTurn），不要遗漏任何被提及成员。
- orchestrate：未点名或点名了你，由你判断复杂度后决定派发方式。
- 被用户显式 @ 的成员应优先安排，不要忽略。

# 任务拆解
- 简单需求用单个 task；复杂需求拆成多个 task。
- 当原始用户需求是可交付产出（如实现一个页面/应用/功能）时，产品需求梳理、PRD、设计方案、调研只是前置步骤，不是最终完成；必须继续安排实现/验证等下游 task（可用 deps 串起来），除非用户明确只要规划文档。
- 如果你先让产品/设计成员澄清或规划，规划完成后仍要根据原始目标继续把实际交付任务派给合适成员（例如前端工程师），不要在前置规划 task 完成后宣布整轮完成。
- deps 表达真实先后依赖：无依赖的任务并行执行，有依赖的等其依赖完成后才执行。互不依赖的任务 deps 留空以便并行。
- deps 只能引用本次 tasks 数组中已定义的 key，绝不引用不存在的 key（否则该任务会永久卡住）。
- objective 要自包含、可独立执行：写清该成员本轮要达成的具体目标，而不是简单复述用户原话。

# 输出契约
- 只输出一个 JSON 对象，不要输出该 JSON 以外的任何解释、前后缀或代码块标记。
- tasks 与 memberTurns 不可同时非空。
- 形如：
  任务：{"tasks":[{"key":"t1","name":"任务名","agentId":"<成员agentId>","deps":[],"objective":"该成员要达成的具体目标以及该成员的职责边界。例如它是前端工程师，那涉及到后端的部分就禁止他去做。并且提醒及时更新需要共享的事实信息。"}],"note":"给用户的说明"}
  直接回复：{"tasks":[],"note":"给用户的完整回复"}
  成员轻量发言：{"tasks":[],"note":"我请大家分别说一句。","memberTurns":[{"agentId":"<成员agentId>","instruction":"用户在向我们打招呼，以你的角色向大家打个招呼，用一句话介绍自己。"}]}

# 上下文沉淀 contextUpdates
- 当用户给出明确的项目目标、需求澄清、产品形态、技术选择、范围裁剪等已确认事实时，**立刻**在 contextUpdates 中同步沉淀，便于服务端写入 projectMeta/黑板。
- 只写用户已明确表达或你已确认的事实，以及用户明确回答的其他成员的答案/决策；decisions 会被记为已批准决策，不要把猜测、待确认的问题或成员的临时观点写成 decisions。`

/**
 * LlmOrchestratorPlanner — 用群配置的 vendor/model + 内置编排 prompt 跑一轮 LLM 产计划。
 *
 * 解析其输出的 JSON 计划；解析失败或产出非法（指派给非成员）时明确失败，
 * 不静默降级成规则分派，避免把 Orchestrator 伪装成真实编排。
 */
@Injectable()
export class LlmOrchestratorExecutor implements OrchestratorExecutor {
    constructor(
        private readonly providers: PlatformProviderService,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly debug: GroupDebugLogger
    ) {}

    async decide(req: DecisionRequest): Promise<OrchestratorDecision> {
        let result: OrchestratorRunResult
        try {
            result = await this.runOrchestrator(req)
        } catch (err) {
            throw BusinessException.upstream('Orchestrator LLM decision failed', {
                groupId: req.group.id,
                providerId: req.group.orchestratorProviderId,
                model: req.group.orchestratorModel,
                error: this.errMsg(err)
            })
        }

        const structuredPlan = this.parsePlanObject(result.structuredOutput, req)
        const parsed = structuredPlan ?? this.parsePlanText(result.text, req)
        if (!parsed) {
            this.debug.log('group.orchestrator_executor.parse_failed', {
                groupId: req.group.id,
                userId: req.userId,
                routeKind: req.routeKind,
                mentionedAgentIds: req.mentionedAgentIds,
                result
            })
            throw BusinessException.upstream('Orchestrator returned an invalid plan', {
                groupId: req.group.id,
                outputPreview: result.text.slice(0, 1000)
            })
        }
        parsed.orchestratorSessionId = result.sessionId ?? null
        const displayText = structuredPlan ? undefined : this.resolveDisplayText(result.text)
        if (displayText) parsed.displayText = displayText
        this.debug.log('group.orchestrator_executor.parsed', {
            groupId: req.group.id,
            userId: req.userId,
            routeKind: req.routeKind,
            mentionedAgentIds: req.mentionedAgentIds,
            parsed
        })
        return parsed
    }

    private async runOrchestrator(req: DecisionRequest): Promise<OrchestratorRunResult> {
        const provider = await this.providers.resolveRuntimeConfig(
            req.userId,
            req.group.orchestratorProviderId
        )
        const home = this.workspace.memberHomeDir(
            req.group.id,
            'orchestrator',
            req.group.workspaceDir
        )
        await this.agentWorkspace.ensureAgentHomeDirectory(req.group.orchestratorVendor, home)

        // Orchestrator 只产 JSON 计划，不该读写真实仓库：禁用全部工具、plan 权限模式、
        // cwd 指向 worktree 外的 home scratch（隔离掉直写共享仓库的风险）。
        const config: AgentAdapterConfig = {
            id: `orch-${req.group.id}`,
            model: req.group.orchestratorModel,
            agentHomeDirectory: home,
            workingDirectory: home,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            reasoningEffort: 'minimal',
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            allowedTools: [],
            permissionMode: 'default'
        }
        const adapter = this.createOrchestratorAdapter(req, config)
        const prompt = this.buildPrompt(req)
        this.debug.log('group.orchestrator_executor.prompt', {
            groupId: req.group.id,
            userId: req.userId,
            vendor: req.group.orchestratorVendor,
            model: req.group.orchestratorModel,
            providerId: req.group.orchestratorProviderId,
            resumedSdkSessionId: req.group.orchestratorSessionId ?? null,
            workingDirectory: config.workingDirectory,
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            prompt
        })
        const first = await this.sendPlanRequest(adapter, prompt, this.buildPlanOutputSchema(req))
        this.debug.log('group.orchestrator_executor.output', {
            groupId: req.group.id,
            userId: req.userId,
            attempt: 'schema',
            result: first
        })
        if (first.success) return first

        const fallback = await this.sendPlanRequest(
            this.createOrchestratorAdapter(req, config),
            prompt
        )
        this.debug.log('group.orchestrator_executor.output', {
            groupId: req.group.id,
            userId: req.userId,
            attempt: 'fallback_text',
            result: fallback
        })
        if (fallback.success) return fallback
        throw new Error(fallback.error ?? first.error ?? 'Orchestrator turn failed')
    }

    private createOrchestratorAdapter(req: DecisionRequest, config: AgentAdapterConfig): AgentAdapter {
        const adapter = createAgent(req.group.orchestratorVendor, config)
        if (req.group.orchestratorSessionId) {
            adapter.resumeWith(req.group.orchestratorSessionId)
        }
        return adapter
    }

    private async sendPlanRequest(
        adapter: ReturnType<typeof createAgent>,
        prompt: string,
        outputSchema?: AgentOutputSchema
    ): Promise<OrchestratorRunResult> {
        const parts: string[] = []
        let finalFromDone: string | null = null
        let structuredOutput: unknown
        let success = true
        let error: string | undefined
        for await (const ev of adapter.send(prompt, outputSchema ? { outputSchema } : undefined)) {
            if (ev.type === 'text') parts.push(ev.text)
            else if (ev.type === 'error' && ev.fatal) {
                success = false
                error = ev.message
            } else if (ev.type === 'done') {
                success = ev.success
                if (ev.finalText) finalFromDone = ev.finalText
                structuredOutput = ev.structuredOutput
            }
        }
        return {
            text: this.combineTextParts(parts, finalFromDone),
            success,
            error,
            structuredOutput,
            sessionId: adapter.sessionId
        }
    }

    private combineTextParts(parts: string[], finalFromDone: string | null): string {
        const merged = parts.map((part) => part.trim()).filter((part) => part.length > 0)
        const finalText = finalFromDone?.trim()
        if (finalText && !merged.includes(finalText)) {
            merged.push(finalText)
        }
        return merged.join('\n\n').trim()
    }

    private resolveDisplayText(text: string): string | undefined {
        const trimmed = text.trim()
        if (!trimmed || this.looksLikePlanJson(trimmed)) return undefined
        return trimmed
    }

    private looksLikePlanJson(text: string): boolean {
        if (!text.startsWith('{') || !text.endsWith('}')) return false
        try {
            const parsed = JSON.parse(text) as { tasks?: unknown }
            return Array.isArray(parsed.tasks)
        } catch {
            return false
        }
    }

    private buildPlanOutputSchema(req: DecisionRequest): AgentOutputSchema {
        const memberIds = req.context.memberStatus.map((m) => m.agentId)
        return {
            type: 'object',
            properties: {
                tasks: {
                    type: 'array',
                    minItems: 0,
                    items: {
                        type: 'object',
                        properties: {
                            key: { type: 'string' },
                            name: { type: 'string' },
                            agentId: {
                                type: 'string',
                                ...(memberIds.length > 0 ? { enum: memberIds } : {})
                            },
                            deps: {
                                type: 'array',
                                items: { type: 'string' }
                            },
                            objective: { type: 'string' }
                        },
                        required: ['key', 'name', 'agentId', 'deps', 'objective'],
                        additionalProperties: false
                    }
                },
                memberTurns: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            agentId: {
                                type: 'string',
                                ...(memberIds.length > 0 ? { enum: memberIds } : {})
                            },
                            instruction: { type: 'string' }
                        },
                        required: ['agentId', 'instruction'],
                        additionalProperties: false
                    }
                },
                contextUpdates: {
                    type: 'object',
                    properties: {
                        projectName: { type: 'string' },
                        projectGoal: { type: ['string', 'null'] },
                        projectTechStack: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        projectStatus: {
                            type: 'string',
                            enum: ['planning', 'designing', 'development', 'done']
                        },
                        decisions: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    content: { type: 'string' },
                                    rationale: { type: ['string', 'null'] },
                                    scope: { type: ['string', 'null'] }
                                },
                                required: ['content'],
                                additionalProperties: false
                            }
                        }
                    },
                    additionalProperties: false
                },
                note: { type: 'string' }
            },
            required: ['tasks'],
            additionalProperties: false
        }
    }

    private buildPrompt(req: DecisionRequest): string {
        const members = req.context.memberStatus
            .map(
                (m) =>
                    `- ${m.agentId} | ${m.name} | ${m.roleInGroup ?? '(未设定)'} | ${m.capabilitySummary ?? '(未设定)'}`
            )
            .join('\n')
        const mentioned = req.mentionedAgentIds.length ? req.mentionedAgentIds.join(', ') : '(none)'
        return [
            `<决策信息>`,
            `- 项目目标：${req.context.projectGoal ?? '(未设定)'}`,
            `- 黑板摘要：\n${req.context.blackboardSummary}`,
            `- Pin 消息上下文：\n${req.context.pinnedMessages || '(无)'}`,
            `- 进行中/未完成的任务：\n${this.renderActiveTaskGraph(req.context.activeTaskGraph)}`,
            `- 成员（agentId | 名称 | 群角色 | 能力摘要）：\n${members}`,
            `- 路由来源 routeKind：${req.routeKind}`,
            `- 用户显式提及的成员 agentId：${mentioned}`,
            `- 用户消息：${req.userText}`,
            `</决策信息>`,
            ``,
            '请结合上文（用户的简短回复可能是对你上一轮提问的回答）按结构化输出 schema 返回计划，遵循系统提示中的三种输出模式与判定规则；必须只输出 JSON。'
        ].join('\n\n')
    }

    /** 把当前黑板上的活跃任务渲染成紧凑列表，供 Orchestrator 感知在途工作、避免重复派发。 */
    private renderActiveTaskGraph(nodes: BlackboardTaskNode[]): string {
        const active = nodes.filter((n) => n.status !== 'done')
        if (active.length === 0) return '(无)'
        return active
            .map((n) => `- [${n.status}] ${n.name}（@${n.agentId ?? '未指派'}）`)
            .join('\n')
    }

    private parsePlanText(text: string, req: DecisionRequest): OrchestratorDecision | null {
        const json = this.extractJson(text)
        if (!json) return null
        let obj: unknown
        try {
            obj = JSON.parse(json)
        } catch {
            return null
        }
        return this.parsePlanObject(obj, req)
    }

    private parsePlanObject(obj: unknown, req: DecisionRequest): OrchestratorDecision | null {
        if (typeof obj !== 'object' || obj === null) return null
        if ('memberMessages' in obj) return null
        const rawTasks = (obj as { tasks?: unknown }).tasks
        if (!Array.isArray(rawTasks)) return null
        const memberIds = new Set(req.context.memberStatus.map((m) => m.agentId))
        const tasks: PlanTask[] = []
        rawTasks.forEach((t, i) => {
            if (typeof t !== 'object' || t === null) return
            const rec = t as Record<string, unknown>
            const agentId = String(rec.agentId ?? '')
            if (!memberIds.has(agentId)) return
            tasks.push({
                key: typeof rec.key === 'string' ? rec.key : `t${i + 1}`,
                name: typeof rec.name === 'string' ? rec.name : `任务${i + 1}`,
                agentId,
                deps: Array.isArray(rec.deps) ? rec.deps.map(String) : [],
                objective: typeof rec.objective === 'string' ? rec.objective : req.userText
            })
        })
        const note =
            typeof (obj as { note?: unknown }).note === 'string'
                ? (obj as { note: string }).note
                : undefined
        const rawMemberTurns = (obj as { memberTurns?: unknown }).memberTurns
        const parsedMemberTurns = this.parseMemberTurns(rawMemberTurns, memberIds)
        if (rawMemberTurns !== undefined && !parsedMemberTurns) {
            return null
        }
        const memberTurns = parsedMemberTurns ?? []
        if (tasks.length > 0 && memberTurns.length > 0) return null
        if (tasks.length === 0) {
            if (rawTasks.length > 0) return null
            if (!note?.trim() && memberTurns.length === 0) return null
        }
        const contextUpdates = this.parseContextUpdates(
            (obj as { contextUpdates?: unknown }).contextUpdates
        )
        if (contextUpdates === null) {
            return null
        }

        return {
            tasks,
            note,
            ...(memberTurns.length > 0 ? { memberTurns } : {}),
            ...(contextUpdates ? { contextUpdates } : {})
        }
    }

    private parseContextUpdates(raw: unknown): OrchestratorContextUpdates | null | undefined {
        if (raw === undefined) return undefined
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
        const rec = raw as Record<string, unknown>
        const updates: OrchestratorContextUpdates = {}

        if (rec.projectName !== undefined) {
            if (typeof rec.projectName !== 'string') return null
            const v = rec.projectName.trim()
            if (v) updates.projectName = v
        }
        if (rec.projectGoal !== undefined) {
            if (rec.projectGoal !== null && typeof rec.projectGoal !== 'string') return null
            const v = typeof rec.projectGoal === 'string' ? rec.projectGoal.trim() : null
            updates.projectGoal = v || null
        }
        if (rec.projectTechStack !== undefined) {
            if (!Array.isArray(rec.projectTechStack)) return null
            updates.projectTechStack = rec.projectTechStack
                .filter((x): x is string => typeof x === 'string')
                .map((x) => x.trim())
                .filter((x) => x.length > 0)
        }
        if (rec.projectStatus !== undefined) {
            if (
                rec.projectStatus !== 'planning' &&
                rec.projectStatus !== 'designing' &&
                rec.projectStatus !== 'development' &&
                rec.projectStatus !== 'done'
            ) {
                return null
            }
            updates.projectStatus = rec.projectStatus
        }
        if (rec.decisions !== undefined) {
            if (!Array.isArray(rec.decisions)) return null
            const decisions: OrchestratorDecisionUpdate[] = []
            for (const item of rec.decisions) {
                if (typeof item !== 'object' || item === null) return null
                const d = item as Record<string, unknown>
                if (typeof d.content !== 'string') return null
                const content = d.content.trim()
                if (!content) continue
                if (
                    d.rationale !== undefined &&
                    d.rationale !== null &&
                    typeof d.rationale !== 'string'
                ) {
                    return null
                }
                if (d.scope !== undefined && d.scope !== null && typeof d.scope !== 'string') {
                    return null
                }
                decisions.push({
                    content,
                    rationale:
                        typeof d.rationale === 'string' && d.rationale.trim()
                            ? d.rationale.trim()
                            : null,
                    scope: typeof d.scope === 'string' && d.scope.trim() ? d.scope.trim() : null
                })
            }
            if (decisions.length > 0) updates.decisions = decisions
        }

        return Object.keys(updates).length > 0 ? updates : undefined
    }

    private parseMemberTurns(raw: unknown, memberIds: Set<string>): PlanMemberTurn[] | null {
        if (raw === undefined) return []
        if (!Array.isArray(raw)) return null
        const seen = new Set<string>()
        const turns: PlanMemberTurn[] = []
        for (const item of raw) {
            if (typeof item !== 'object' || item === null) return null
            const rec = item as Record<string, unknown>
            const agentId = typeof rec.agentId === 'string' ? rec.agentId : ''
            const instruction = typeof rec.instruction === 'string' ? rec.instruction.trim() : ''
            if (!memberIds.has(agentId) || !instruction || seen.has(agentId)) return null
            seen.add(agentId)
            turns.push({ agentId, instruction })
        }
        return turns
    }

    private extractJson(text: string): string | null {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenced) return fenced[1].trim()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start >= 0 && end > start) return text.slice(start, end + 1)
        return null
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
