import { Injectable } from '@nestjs/common'
import type { BlackboardTaskNode, GroupRouteKind } from '@agenthub/shared'
import {
    createAgent,
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

export interface PlanMemberMessage {
    /** 以该成员身份展示的纯聊天消息，不代表实际执行成员 turn。 */
    agentId: string
    text: string
}

export interface OrchestratorPlan {
    /** 空数组表示只需要 Orchestrator 回复，不应创建黑板任务或派发成员。 */
    tasks: PlanTask[]
    /** 给用户的开场说明（可空） */
    note?: string
    /** 非任务成员回复，可让成员以聊天气泡形式出现；不写黑板、不派发成员。 */
    memberMessages?: PlanMemberMessage[]
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
}

/**
 * 系统内置编排提示词（用户不填）。要求 Orchestrator 仅输出结构化 JSON 计划。
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator（编排者）。
你的职责：理解用户意图，判断复杂度；需要实际产出或行动时，把任务拆解并指派给最合适的成员 Agent。
铁律：
- 你不亲自写代码/产出物。
- 问候、感谢、闲聊、状态询问、设计/产品/技术合理性咨询、轻量评审、澄清讨论等无需成员执行工具或产出文件的消息，只返回空 tasks，并用 note / memberMessages 回复；不要为这类消息创建任务。
- 如果用户明确要求"大家/你们/群成员打招呼、介绍一下、出来认识一下"，或用户在咨询某个成员角色适合回答的问题（例如产品经理评估设计是否合理、前端工程师说明交互实现取舍），返回空 tasks、note，以及相关 memberMessages；每个 memberMessages 项代表一个成员的简短聊天气泡，不是任务。
- 只有当用户要求创建/修改文件、实现功能、产出文档、执行命令、检查工作区或完成可交付事项时，才创建 tasks。
- 面向黑板协作，不臆造未提供的事实。
- 只能指派给给定的成员 Agent（用其 agentId）。
- 输出必须是一个 JSON 对象，且只输出该 JSON（不要额外解释），形如：
{"tasks":[{"key":"t1","name":"任务名","agentId":"<成员agentId>","deps":[],"objective":"该成员要达成的具体目标"}],"note":"给用户的一句话说明"}
- 非任务消息形如：{"tasks":[],"note":"给用户的直接回复"}。
- 成员纯聊天消息形如：{"tasks":[],"note":"我请相关成员先给一个判断。","memberMessages":[{"agentId":"<成员agentId>","text":"一句简短观点、建议或问候"}]}。
- 简单任务用单个 task；复杂任务拆成多个 task（本期串行执行，deps 仅表达顺序）。`

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

        const config: AgentAdapterConfig = {
            id: `orch-${req.group.id}`,
            model: req.group.orchestratorModel,
            agentHomeDirectory: home,
            workingDirectory: this.workspace.repoDir(req.group.id, req.group.workspaceDir),
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
            permissionMode: 'bypassPermissions'
        }
        const adapter = createAgent(req.group.orchestratorVendor, config)
        const prompt = this.buildPrompt(req)
        this.debug.log('group.orchestrator_planner.prompt', {
            groupId: req.group.id,
            userId: req.userId,
            vendor: req.group.orchestratorVendor,
            model: req.group.orchestratorModel,
            providerId: req.group.orchestratorProviderId,
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
            createAgent(req.group.orchestratorVendor, config),
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
            text: (finalFromDone ?? parts.join('')).trim(),
            success,
            error,
            structuredOutput
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
                memberMessages: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            agentId: {
                                type: 'string',
                                ...(memberIds.length > 0 ? { enum: memberIds } : {})
                            },
                            text: { type: 'string' }
                        },
                        required: ['agentId', 'text'],
                        additionalProperties: false
                    }
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
            '请按结构化输出 schema 返回计划；如果用户只是问候、闲聊、询问状态、征求设计/产品/技术观点或做轻量评审，请返回空 tasks，并用 note / memberMessages 直接回复；只有需要实际产出或修改时才创建 tasks。'
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
        const rawMemberMessages = (obj as { memberMessages?: unknown }).memberMessages
        const parsedMemberMessages = this.parseMemberMessages(rawMemberMessages, memberIds)
        if (rawMemberMessages !== undefined && !parsedMemberMessages) {
            return null
        }
        const memberMessages = parsedMemberMessages ?? []
        const note =
            typeof (obj as { note?: unknown }).note === 'string'
                ? (obj as { note: string }).note
                : undefined
        if (tasks.length === 0) {
            if (rawTasks.length > 0) return null
            if (!note?.trim() && (!memberMessages || memberMessages.length === 0)) return null
        }
        return {
            tasks,
            note,
            ...(memberMessages.length > 0 ? { memberMessages } : {})
        }
    }

    private parseMemberMessages(
        raw: unknown,
        memberIds: Set<string>
    ): PlanMemberMessage[] | null {
        if (raw === undefined) return []
        if (!Array.isArray(raw)) return null
        const seen = new Set<string>()
        const messages: PlanMemberMessage[] = []
        for (const item of raw) {
            if (typeof item !== 'object' || item === null) return null
            const rec = item as Record<string, unknown>
            const agentId = typeof rec.agentId === 'string' ? rec.agentId : ''
            const text = typeof rec.text === 'string' ? rec.text.trim() : ''
            if (!memberIds.has(agentId) || !text || seen.has(agentId)) return null
            seen.add(agentId)
            messages.push({ agentId, text })
        }
        return messages
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
