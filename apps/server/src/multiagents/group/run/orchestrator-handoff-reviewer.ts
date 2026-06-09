import { Inject, Injectable } from '@nestjs/common'
import type { BlackboardTaskNode } from '@agenthub/shared'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { CHAT_CLIENT, type ChatClient } from '../../../chat-client/index.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
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
}

export interface OrchestratorTaskHandoffReviewer {
    review(req: OrchestratorTaskHandoffReviewRequest): Promise<OrchestratorTaskHandoffReviewResult>
}

interface HandoffRunResult {
    text: string
    responseId?: string
}

const HANDOFF_REVIEW_SYSTEM_PROMPT = `你是 AgentHub 群聊的内部交接裁判，只负责判断一个刚结束的成员任务是否可以释放下游任务。
你是无状态的一次性判断器，不参与用户对话，不继承 Orchestrator 的连续会话，也不要假设本次输入以外的事实。

【你的职责】
- 只根据本次提供的用户原始需求、当前任务、成员最终输出、黑板摘要和直接下游任务做判断。
- 如果成员最终输出是在向用户澄清、确认、选择或索取继续所需的信息，且该信息会阻塞当前任务收尾或下游任务启动，返回 awaitingUserInput=true、completed=false。
- 如果成员只是礼貌性地说"有问题再问我"、给出不阻塞的建议问题、或列出后续可选优化，不要判定为等待用户。
- 如果成员输出已经实质满足当前任务目标，并且没有阻塞性用户问题，返回 completed=true、awaitingUserInput=false。
- 如果成员输出没有提出用户问题，但也没有实质完成当前任务目标，返回 completed=false、awaitingUserInput=false。
- 这是内部控制面判断，不要面向用户写汇报文案，不要创建任务，不要安排 Agent。

【输出要求】
- 只输出一个 JSON 对象，不要输出代码块标记或任何额外解释。
- completed：该成员任务是否可视为完成并释放下游。
- awaitingUserInput：是否应暂停下游，等待用户先回答成员的问题。
- question：awaitingUserInput=true 时，提炼一个用户需要回答的简短问题；否则必须为 null。
- reason：一句话说明判断依据。

JSON 形状：
{"completed":boolean,"awaitingUserInput":boolean,"question":string|null,"reason":"..."}`

@Injectable()
export class LlmOrchestratorHandoffReviewer implements OrchestratorTaskHandoffReviewer {
    constructor(
        private readonly providers: PlatformProviderService,
        @Inject(CHAT_CLIENT)
        private readonly chatClient: ChatClient,
        private readonly blackboard: BlackboardService,
        private readonly debug: GroupDebugLogger
    ) {}

    async review(
        req: OrchestratorTaskHandoffReviewRequest
    ): Promise<OrchestratorTaskHandoffReviewResult> {
        const result = await this.runReviewer(req)
        const parsed = this.parseReviewText(result.text)
        if (!parsed) {
            this.debug.log('group.orchestrator_handoff_review.parse_failed', {
                groupId: req.group.id,
                runId: req.runId,
                result
            })
            throw new Error('Orchestrator handoff review returned invalid output')
        }
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
        const prompt = await this.buildPrompt(req)
        this.debug.log('group.orchestrator_handoff_review.prompt', {
            groupId: req.group.id,
            runId: req.runId,
            taskId: req.task.id,
            providerType: provider.type,
            model: req.group.orchestratorModel,
            prompt
        })
        const response = await this.chatClient.chat({
            providerType: provider.type,
            model: req.group.orchestratorModel,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            systemPrompt: HANDOFF_REVIEW_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 1024,
            ...(provider.type === 'anthropic' ? {} : { temperature: 0 })
        })
        this.debug.log('group.orchestrator_handoff_review.output', {
            groupId: req.group.id,
            runId: req.runId,
            taskId: req.task.id,
            responseId: response.id ?? null,
            usage: response.usage ?? null,
            text: response.text
        })
        return {
            text: response.text,
            responseId: response.id
        }
    }

    private async buildPrompt(req: OrchestratorTaskHandoffReviewRequest): Promise<string> {
        const blackboardSummary = await this.blackboard.summarize(req.group.id)
        return [
            '# 群聊与项目上下文',
            `- groupId: ${req.group.id}`,
            `- projectName: ${req.group.projectName}`,
            `- projectGoal: ${req.group.projectGoal ?? '(未设定)'}`,
            `- projectStatus: ${req.group.projectStatus}`,
            '',
            '# 用户原始需求',
            req.originalUserText || '(未提供)',
            '',
            '# 刚结束的成员任务',
            `- taskId=${req.task.id}`,
            `- name=${req.task.name}`,
            `- agent=${req.task.agentName ?? req.task.agentId ?? '(unknown)'}`,
            `- objective=${req.task.objective}`,
            '',
            '# 成员最终输出',
            req.task.summary || '(无输出)',
            '',
            '# 直接依赖该任务的下游任务',
            this.renderDownstream(req.downstreamTasks),
            '',
            '# 当前黑板摘要',
            blackboardSummary,
            '',
            '# 判断问题',
            '请判断这个成员任务是否可以视为完成并释放下游任务，还是必须先等待用户回答成员提出的阻塞性问题。只输出符合系统提示 JSON 形状的对象。'
        ].join('\n\n')
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
