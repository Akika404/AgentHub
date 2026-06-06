import { Inject, Injectable } from '@nestjs/common'
import type { BlackboardTaskNode, GroupRouteKind, TaskItem } from '@agenthub/shared'
import type { Agent } from '../../entities/agent.entity.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import {
    ORCHESTRATOR_PLANNER,
    type OrchestratorPlanner,
    type OrchestratorContext
} from './orchestrator-planner.js'

export interface OrchestratorPlanParams {
    group: GroupChat
    userId: string
    runId: string
    userText: string
    routeKind: GroupRouteKind
    mentionedAgentIds: string[]
    members: Array<{ member: GroupChatMember; agent: Agent }>
}

export interface OrchestratorPlanResult {
    nodes: BlackboardTaskNode[]
    note?: string
}

export interface TaskOutcome {
    name: string
    summary: string
    success: boolean
}

/**
 * OrchestratorService — 独立内置编排角色：用群配置 vendor/model + 内置 prompt 产计划
 *（经可注入 OrchestratorPlanner），写黑板 task_graph + 发 task-list 消息，末尾聚合汇报。
 */
@Injectable()
export class OrchestratorService {
    constructor(
        @Inject(ORCHESTRATOR_PLANNER)
        private readonly planner: OrchestratorPlanner,
        private readonly blackboard: BlackboardService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream
    ) {}

    /** 生成计划 → 写 task_graph → 发 task-list 消息 → 推 orchestrator_plan 事件。 */
    async plan(params: OrchestratorPlanParams): Promise<OrchestratorPlanResult> {
        const { group, userId, runId, routeKind, mentionedAgentIds, members } = params

        const state = await this.blackboard.getState(group.id)
        const context: OrchestratorContext = {
            projectGoal: group.projectGoal,
            blackboardSummary: await this.blackboard.summarize(group.id),
            recentUserIntents: [params.userText],
            memberStatus: members.map(({ member, agent }) => ({
                agentId: agent.id,
                name: agent.name,
                roleInGroup: member.roleInGroup
            })),
            activeTaskGraph: state.taskGraph
        }

        const plan = await this.planner.plan({
            group,
            userId,
            userText: params.userText,
            routeKind,
            mentionedAgentIds,
            context
        })

        if (plan.tasks.length === 0) {
            await this.groupMessages.appendSystem(
                group.id,
                userId,
                'Orchestrator 未能生成可执行的任务计划。'
            )
            return { nodes: [], note: plan.note }
        }

        const nodes = await this.blackboard.upsertTaskGraph(
            group.id,
            runId,
            plan.tasks.map((t) => ({
                key: t.key,
                name: t.name,
                agentId: t.agentId,
                deps: t.deps,
                objective: t.objective,
                status: 'ready'
            }))
        )

        const items: TaskItem[] = nodes.map((n) => ({
            id: n.id,
            title: n.name,
            status: 'pending'
        }))
        await this.groupMessages.appendTaskList(
            group.id,
            userId,
            'orchestrator',
            plan.note ?? '任务计划',
            items
        )
        await this.runStream.publish(runId, {
            type: 'orchestrator_plan',
            runId,
            routeKind,
            tasks: nodes
        })

        return { nodes, note: plan.note }
    }

    /** 聚合各成员产出，生成 text 汇报消息发到 presentation_log + 推 orchestrator_report。 */
    async report(
        group: GroupChat,
        userId: string,
        runId: string,
        outcomes: TaskOutcome[]
    ): Promise<string> {
        const allOk = outcomes.every((o) => o.success)
        const head = outcomes.length === 0
            ? '本轮没有产生任务。'
            : allOk
              ? '本轮任务已全部完成：'
              : '本轮任务部分完成（遇失败已停止后续派发）：'
        const lines = outcomes.map((o) => `- ${o.success ? '✅' : '❌'} ${o.name}：${o.summary}`)
        const text = [head, ...lines].join('\n')
        await this.groupMessages.appendText(group.id, userId, 'orchestrator', text)
        await this.runStream.publish(runId, { type: 'orchestrator_report', runId, text })
        return text
    }
}
