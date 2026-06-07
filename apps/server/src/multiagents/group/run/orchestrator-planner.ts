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

export interface OrchestratorPlan {
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

export interface PlanRequest {
    group: GroupChat
    userId: string
    userText: string
    routeKind: GroupRouteKind
    mentionedAgentIds: string[]
    context: OrchestratorContext
}

export interface OrchestratorPlanner {
    plan(req: PlanRequest): Promise<OrchestratorPlan>
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
export const ORCHESTRATOR_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator（编排者）。
你的职责：理解用户意图，判断复杂度；需要实际产出或行动时，把任务拆解并指派给最合适的成员 Agent。
铁律：
- 你不亲自写代码/产出物。
- 问候、感谢、闲聊、状态询问、澄清讨论等无需成员执行工具或产出文件的消息，只返回空 tasks，并用 note 以 Orchestrator 身份回复；不要为这类消息创建任务。
- 不允许代替成员 Agent 发言；只有真实派发给成员并完成成员 turn 后，才能出现成员身份的消息。
- 只有当用户要求创建/修改文件、实现功能、产出文档、执行命令、检查工作区或完成可交付事项时，才创建 tasks。
- 用户要求“探索/检查/读取/查看工作区”、或在你说明要探索/执行后继续催促“那你探索啊/继续/开始做”时，必须创建成员 task；你自己不要尝试读取文件、调用工具或把它当成澄清/noop。
- 用户要求成员回答一个需要角色判断、方案建议、信息整理或问题解答的问题时，如果无需工具/文件，使用 memberTurns；如果需要读取文件、检查工作区或形成可交付回答，使用 tasks。
- 如果用户咨询某个成员角色适合回答的问题，或明确要求成员本人打招呼/介绍/表达观点，但无需工具或产出文件，应返回 tasks: [] 并创建 memberTurns，让成员真实轻量回复；不要创建黑板任务。
- 面向黑板协作，不臆造未提供的事实。
- 只能指派给给定的成员 Agent（用其 agentId）。
- 输出必须是一个 JSON 对象，且只输出该 JSON（不要额外解释），形如：
{"tasks":[{"key":"t1","name":"任务名","agentId":"<成员agentId>","deps":[],"objective":"该成员要达成的具体目标"}],"note":"给用户的一句话说明"}
- 非任务消息形如：{"tasks":[],"note":"给用户的直接回复"}。
- 成员轻量聊天形如：{"tasks":[],"note":"我请大家分别说一句。","memberTurns":[{"agentId":"<成员agentId>","instruction":"请以你的角色向大家打个招呼，用一句话介绍自己。"}]}。
- tasks 和 memberTurns 不要同时出现；需要实际产出时用 tasks，需要真实成员轻量发言时用 memberTurns。
- 简单任务用单个 task；复杂任务拆成多个 task：deps 表达**真实依赖**——无依赖的任务会并行执行，有依赖的任务等其依赖完成后才执行。请按真实先后关系填 deps，互不依赖的任务 deps 留空以便并行。
- 你拥有连续会话上下文；当用户给出项目目标、需求澄清、技术选择、交互形式、范围裁剪等明确事实时，在 contextUpdates 中同步沉淀，便于服务端写入 projectMeta/黑板。
- contextUpdates 只写用户已明确表达或你已确认的事实，不要把猜测、待确认问题或成员临时观点写成已确认决策。`

/**
 * LlmOrchestratorPlanner — 用群配置的 vendor/model + 内置编排 prompt 跑一轮 LLM 产计划。
 *
 * 解析其输出的 JSON 计划；解析失败或产出非法（指派给非成员）时明确失败，
 * 不静默降级成规则分派，避免把 Orchestrator 伪装成真实编排。
 */
@Injectable()
export class LlmOrchestratorPlanner implements OrchestratorPlanner {
    constructor(
        private readonly providers: PlatformProviderService,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly debug: GroupDebugLogger
    ) {}

    async plan(req: PlanRequest): Promise<OrchestratorPlan> {
        let result: OrchestratorRunResult
        try {
            result = await this.runOrchestrator(req)
        } catch (err) {
            throw BusinessException.upstream('Orchestrator LLM planning failed', {
                groupId: req.group.id,
                providerId: req.group.orchestratorProviderId,
                model: req.group.orchestratorModel,
                error: this.errMsg(err)
            })
        }

        const parsed =
            this.parsePlanObject(result.structuredOutput, req) ??
            this.parsePlanText(result.text, req)
        if (!parsed) {
            this.debug.log('group.orchestrator_planner.parse_failed', {
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
        const displayText = this.resolveDisplayText(result.text)
        if (displayText) parsed.displayText = displayText
        this.debug.log('group.orchestrator_planner.parsed', {
            groupId: req.group.id,
            userId: req.userId,
            routeKind: req.routeKind,
            mentionedAgentIds: req.mentionedAgentIds,
            parsed
        })
        return parsed
    }

    private async runOrchestrator(req: PlanRequest): Promise<OrchestratorRunResult> {
        const provider = await this.providers.resolveRuntimeConfig(
            req.userId,
            req.group.orchestratorProviderId
        )
        const home = this.workspace.memberHomeDir(req.group.id, 'orchestrator')
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
            reasoningEffort: "minimal",
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            allowedTools: [],
            permissionMode: 'default'
        }
        const adapter = this.createOrchestratorAdapter(req, config)
        const prompt = this.buildPrompt(req)
        this.debug.log('group.orchestrator_planner.prompt', {
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
        this.debug.log('group.orchestrator_planner.output', {
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
        this.debug.log('group.orchestrator_planner.output', {
            groupId: req.group.id,
            userId: req.userId,
            attempt: 'fallback_text',
            result: fallback
        })
        if (fallback.success) return fallback
        throw new Error(fallback.error ?? first.error ?? 'Orchestrator turn failed')
    }

    private createOrchestratorAdapter(req: PlanRequest, config: AgentAdapterConfig): AgentAdapter {
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

    private buildPlanOutputSchema(req: PlanRequest): AgentOutputSchema {
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

    private buildPrompt(req: PlanRequest): string {
        const members = req.context.memberStatus
            .map(
                (m) =>
                    `- ${m.agentId} | ${m.name} | ${m.roleInGroup ?? '(未设定)'} | ${m.capabilitySummary ?? '(未设定)'}`
            )
            .join('\n')
        const mentioned = req.mentionedAgentIds.length ? req.mentionedAgentIds.join(', ') : '(none)'
        return [
            `项目目标：${req.context.projectGoal ?? '(未设定)'}`,
            `黑板摘要：\n${req.context.blackboardSummary}`,
            `成员（agentId | 名称 | 群角色 | 能力摘要）：\n${members}`,
            `路由来源：${req.routeKind}`,
            `用户显式提及的成员 agentId：${mentioned}`,
            `用户消息：${req.userText}`,
            '请按结构化输出 schema 返回计划；如果用户只是问候、闲聊、询问状态或澄清讨论，请返回空 tasks，并用 note 以 Orchestrator 身份直接回复。不要代替成员发言；如果需要真实成员轻量回答但无需工具/文件产出，请返回 memberTurns；只有需要实际产出/修改时才创建 tasks。用户要求探索/检查/读取工作区、或在你说要探索/执行后催促继续时，必须创建成员 task，不要自己尝试工具，也不要返回空 tasks。',
            '如本轮用户明确给出了项目目标、需求澄清、产品形式、技术选择或其它已确认选择，请在 contextUpdates 中同步沉淀：projectGoal/projectName/projectTechStack/projectStatus 写入 projectMeta，decisions 写入黑板决策。不要把未确认猜测写入 contextUpdates。'
        ].join('\n\n')
    }

    private parsePlanText(text: string, req: PlanRequest): OrchestratorPlan | null {
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

    private parsePlanObject(obj: unknown, req: PlanRequest): OrchestratorPlan | null {
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
