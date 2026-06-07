import { Injectable } from '@nestjs/common'
import type { BlackboardTaskNode } from '@agenthub/shared'
import {
    createAgent,
    type AgentAdapter,
    type AgentAdapterConfig,
    type AgentOutputSchema
} from '../../adapter/index.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

export const ORCHESTRATOR_HANDOFF_REVIEWER = Symbol('ORCHESTRATOR_HANDOFF_REVIEWER')

export interface OrchestratorTaskHandoffReviewRequest {
    group: GroupChat
    userId: string
    runId: string
    originalUserText: string
    task: {
        id: string
        name: string
        objective: string
        agentId: string | null
        agentName: string | null
        summary: string
    }
    downstreamTasks: Array<
        Pick<BlackboardTaskNode, 'id' | 'name' | 'objective' | 'agentId' | 'deps'>
    >
}

export interface OrchestratorTaskHandoffReviewResult {
    completed: boolean
    awaitingUserInput: boolean
    question: string | null
    reason: string
    orchestratorSessionId?: string | null
}

export interface OrchestratorTaskHandoffReviewer {
    review(req: OrchestratorTaskHandoffReviewRequest): Promise<OrchestratorTaskHandoffReviewResult>
}

interface HandoffRunResult {
    text: string
    success: boolean
    error?: string
    structuredOutput?: unknown
    sessionId?: string | null
}

const HANDOFF_REVIEW_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator，负责在成员任务结束后做隐藏交接判断。
你会看到：用户原始需求、刚结束的成员任务、成员最终输出、黑板摘要、以及依赖它的下游任务。

【你的职责】
- 判断刚结束的成员任务是否真的已经完成到可以释放下游任务。
- 如果成员最终输出实质上是在向用户澄清、确认、选择或索取继续所需的信息，即使它没有按结构化 report 格式声明 awaiting_user_input，也必须判定 awaitingUserInput=true、completed=false。
- 如果成员只是给出完成总结、附带礼貌性"有问题再问我"、或提出不阻塞下游的建议问题，不要判定为等待用户。
- 若 awaitingUserInput=true，question 要提炼为用户需要回答的简短问题；若没有等待用户，question 必须为 null。
- 这是内部判断，不要面向用户写汇报文案，也不要创建任务。

【输出要求】
- 只输出一个 JSON 对象，不要输出代码块标记或任何额外解释。
- completed：该成员任务是否可视为完成并释放下游。
- awaitingUserInput：是否应暂停下游，等待用户先回答成员的问题。
- question：awaitingUserInput=true 时的简短问题；否则 null。
- reason：一句话说明判断依据。`

@Injectable()
export class LlmOrchestratorHandoffReviewer implements OrchestratorTaskHandoffReviewer {
    constructor(
        private readonly providers: PlatformProviderService,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly blackboard: BlackboardService,
        private readonly debug: GroupDebugLogger
    ) {}

    async review(
        req: OrchestratorTaskHandoffReviewRequest
    ): Promise<OrchestratorTaskHandoffReviewResult> {
        const result = await this.runReviewer(req)
        if (!result.success) {
            throw new Error(result.error ?? 'Orchestrator handoff review failed')
        }
        const parsed =
            this.parseReviewObject(result.structuredOutput) ?? this.parseReviewText(result.text)
        if (!parsed) {
            this.debug.log('group.orchestrator_handoff_review.parse_failed', {
                groupId: req.group.id,
                runId: req.runId,
                result
            })
            throw new Error('Orchestrator handoff review returned invalid output')
        }
        parsed.orchestratorSessionId = result.sessionId ?? null
        this.debug.log('group.orchestrator_handoff_review.parsed', {
            groupId: req.group.id,
            runId: req.runId,
            taskId: req.task.id,
            review: parsed
        })
        return parsed
    }

    private async runReviewer(
        req: OrchestratorTaskHandoffReviewRequest
    ): Promise<HandoffRunResult> {
        const provider = await this.providers.resolveRuntimeConfig(
            req.userId,
            req.group.orchestratorProviderId
        )
        const home = this.workspace.memberHomeDir(req.group.id, 'orchestrator')
        await this.agentWorkspace.ensureAgentHomeDirectory(req.group.orchestratorVendor, home)

        const config: AgentAdapterConfig = {
            id: `orch-handoff-${req.group.id}`,
            model: req.group.orchestratorModel,
            agentHomeDirectory: home,
            workingDirectory: home,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            reasoningEffort: 'minimal',
            systemPrompt: HANDOFF_REVIEW_SYSTEM_PROMPT,
            allowedTools: [],
            permissionMode: 'default'
        }
        const adapter = this.createReviewerAdapter(req, config)
        const prompt = await this.buildPrompt(req)
        this.debug.log('group.orchestrator_handoff_review.prompt', {
            groupId: req.group.id,
            runId: req.runId,
            taskId: req.task.id,
            resumedSdkSessionId: req.group.orchestratorSessionId ?? null,
            prompt
        })
        const first = await this.sendReviewRequest(adapter, prompt, this.outputSchema())
        if (first.success) return first
        return this.sendReviewRequest(this.createReviewerAdapter(req, config), prompt)
    }

    private createReviewerAdapter(
        req: OrchestratorTaskHandoffReviewRequest,
        config: AgentAdapterConfig
    ): AgentAdapter {
        const adapter = createAgent(req.group.orchestratorVendor, config)
        if (req.group.orchestratorSessionId) {
            adapter.resumeWith(req.group.orchestratorSessionId)
        }
        return adapter
    }

    private async sendReviewRequest(
        adapter: ReturnType<typeof createAgent>,
        prompt: string,
        outputSchema?: AgentOutputSchema
    ): Promise<HandoffRunResult> {
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
        const textParts = parts.map((part) => part.trim()).filter((part) => part.length > 0)
        const finalText = finalFromDone?.trim()
        if (finalText && !textParts.includes(finalText)) textParts.push(finalText)
        return {
            text: textParts.join('\n\n').trim(),
            success,
            error,
            structuredOutput,
            sessionId: adapter.sessionId
        }
    }

    private outputSchema(): AgentOutputSchema {
        return {
            type: 'object',
            properties: {
                completed: { type: 'boolean' },
                awaitingUserInput: { type: 'boolean' },
                question: { type: ['string', 'null'] },
                reason: { type: 'string' }
            },
            required: ['completed', 'awaitingUserInput', 'question', 'reason'],
            additionalProperties: false
        }
    }

    private async buildPrompt(req: OrchestratorTaskHandoffReviewRequest): Promise<string> {
        const blackboardSummary = await this.blackboard.summarize(req.group.id)
        return [
            `项目名称：${req.group.projectName}`,
            `项目目标：${req.group.projectGoal ?? '(未设定)'}`,
            `用户原始需求：${req.originalUserText}`,
            '',
            '刚结束的成员任务：',
            `- taskId=${req.task.id}`,
            `- name=${req.task.name}`,
            `- agent=${req.task.agentName ?? req.task.agentId ?? '(unknown)'}`,
            `- objective=${req.task.objective}`,
            '',
            `成员最终输出：\n${req.task.summary || '(无输出)'}`,
            '',
            `依赖它的下游任务：\n${this.renderDownstream(req.downstreamTasks)}`,
            '',
            `黑板摘要：\n${blackboardSummary}`,
            '',
            '请判断是否可以释放下游任务，或需要先等待用户回答成员的问题。'
        ].join('\n')
    }

    private renderDownstream(
        downstreamTasks: OrchestratorTaskHandoffReviewRequest['downstreamTasks']
    ): string {
        if (downstreamTasks.length === 0) return '(无直接下游任务)'
        return downstreamTasks
            .map(
                (task) =>
                    `- ${task.name} (taskId=${task.id}, agentId=${task.agentId ?? '(未指派)'}, deps=${task.deps.join(', ') || '(无)'}): ${task.objective}`
            )
            .join('\n')
    }

    private parseReviewText(text: string): OrchestratorTaskHandoffReviewResult | null {
        const json = this.extractJson(text)
        if (!json) return null
        try {
            return this.parseReviewObject(JSON.parse(json))
        } catch {
            return null
        }
    }

    private parseReviewObject(obj: unknown): OrchestratorTaskHandoffReviewResult | null {
        if (typeof obj !== 'object' || obj === null) return null
        const rec = obj as Record<string, unknown>
        if (typeof rec.completed !== 'boolean') return null
        if (typeof rec.awaitingUserInput !== 'boolean') return null
        if (rec.question !== null && typeof rec.question !== 'string') return null
        if (typeof rec.reason !== 'string' || !rec.reason.trim()) return null
        const awaitingUserInput = rec.awaitingUserInput
        const question =
            typeof rec.question === 'string' && rec.question.trim() ? rec.question.trim() : null
        return {
            completed: awaitingUserInput ? false : rec.completed,
            awaitingUserInput,
            question: awaitingUserInput ? question : null,
            reason: rec.reason.trim()
        }
    }

    private extractJson(text: string): string | null {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenced) return fenced[1].trim()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start >= 0 && end > start) return text.slice(start, end + 1)
        return null
    }
}
