import { Inject, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type { BlackboardTaskNode, GroupRouteKind, TaskItem } from '@agenthub/shared'
import { Repository } from 'typeorm'
import type { Agent } from '../../entities/agent.entity.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import {
    ORCHESTRATOR_PLANNER,
    type OrchestratorPlanner,
    type OrchestratorContext,
    type OrchestratorContextUpdates,
    type PlanMemberTurn
} from './orchestrator-planner.js'
import type { DispatchEscalation } from './dispatch.service.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

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
    displayText?: string
    memberTurns: PlanMemberTurn[]
}

export interface TaskOutcome {
    name: string
    summary: string
    success: boolean
    status: 'done' | 'failed' | 'blocked'
    /** 存在时表示该任务遇冲突需用户裁决，汇报里单列"需你决策"。 */
    escalation?: DispatchEscalation
}

/**
 * OrchestratorService — 独立内置编排角色：用群配置 vendor/model + 内置 prompt 产计划
 *（经可注入 OrchestratorPlanner）。任务消息写黑板 task_graph + 发 task-list；
 * 非任务消息只发 Orchestrator 文本回复；成员消息必须来自真实成员 turn。
 * 轻量成员聊天返回 memberTurns，不写黑板 task_graph。
 */
@Injectable()
export class OrchestratorService {
    constructor(
        @Inject(ORCHESTRATOR_PLANNER)
        private readonly planner: OrchestratorPlanner,
        @InjectRepository(GroupChat)
        private readonly groupRepo: Repository<GroupChat>,
        private readonly blackboard: BlackboardService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger
    ) {}

    /** 生成计划；有任务则写 task_graph + 发 task-list，非任务则只回复文本。 */
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
                roleInGroup: member.roleInGroup,
                capabilitySummary: agent.capabilitySummary ?? null
            })),
            activeTaskGraph: state.taskGraph
        }
        this.debug.log('group.orchestrator.context', {
            groupId: group.id,
            runId,
            userId,
            userText: params.userText,
            routeKind,
            mentionedAgentIds,
            blackboard: this.debug.blackboardSnapshot(state),
            context
        })

        const plan = await this.planner.plan({
            group,
            userId,
            userText: params.userText,
            routeKind,
            mentionedAgentIds,
            context
        })
        this.debug.log('group.orchestrator.plan.raw', {
            groupId: group.id,
            runId,
            routeKind,
            mentionedAgentIds,
            plan
        })
        await this.persistPlannerState(group, userId, runId, plan)

        if (plan.tasks.length === 0) {
            const text = plan.displayText?.trim() || plan.note?.trim() || '收到。'
            await this.groupMessages.appendText(group.id, userId, 'orchestrator', text)
            await this.runStream.publish(runId, {
                type: 'orchestrator_report',
                runId,
                text
            })
            this.debug.log('group.orchestrator.plan.noop', {
                groupId: group.id,
                runId,
                routeKind,
                mentionedAgentIds,
                note: plan.note,
                displayText: plan.displayText ?? null,
                memberTurns: plan.memberTurns ?? []
            })
            return {
                nodes: [],
                note: plan.note,
                ...(plan.displayText ? { displayText: plan.displayText } : {}),
                memberTurns: plan.memberTurns ?? []
            }
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
                // 无依赖即就绪可派发；有依赖先 pending，待 DAG 调度器解锁
                status: t.deps.length === 0 ? 'ready' : 'pending'
            }))
        )

        const items: TaskItem[] = nodes.map((n) => ({
            id: n.id,
            title: n.name,
            status: this.toTaskItemStatus(n.status)
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
        this.debug.log('group.orchestrator.plan.persisted', {
            groupId: group.id,
            runId,
            routeKind,
            assignments: nodes.map((n) => ({
                taskId: n.id,
                name: n.name,
                agentId: n.agentId,
                deps: n.deps,
                objective: n.objective,
                status: n.status
            })),
            note: plan.note
        })

        return { nodes, note: plan.note, memberTurns: [] }
    }

    private async persistPlannerState(
        group: GroupChat,
        userId: string,
        runId: string,
        plan: {
            orchestratorSessionId?: string | null
            contextUpdates?: OrchestratorContextUpdates
        }
    ): Promise<void> {
        const updates = plan.contextUpdates
        let groupChanged = false
        if (plan.orchestratorSessionId && group.orchestratorSessionId !== plan.orchestratorSessionId) {
            group.orchestratorSessionId = plan.orchestratorSessionId
            groupChanged = true
        }
        if (updates?.projectName !== undefined && updates.projectName !== group.projectName) {
            group.projectName = updates.projectName
            groupChanged = true
        }
        if (updates?.projectGoal !== undefined && updates.projectGoal !== group.projectGoal) {
            group.projectGoal = updates.projectGoal
            groupChanged = true
        }
        if (
            updates?.projectTechStack !== undefined &&
            !this.sameStringArray(updates.projectTechStack, group.projectTechStack ?? [])
        ) {
            group.projectTechStack = updates.projectTechStack
            groupChanged = true
        }
        if (updates?.projectStatus !== undefined && updates.projectStatus !== group.projectStatus) {
            group.projectStatus = updates.projectStatus
            groupChanged = true
        }
        if (groupChanged) {
            await this.groupRepo.save(group)
        }

        const decisions = updates?.decisions ?? []
        const createdDecisionIds: string[] = []
        const existingDecisionKeys =
            decisions.length > 0
                ? new Set(
                      (await this.blackboard.getState(group.id)).decisions.map((d) =>
                          this.decisionKey(d.content, d.scope)
                      )
                  )
                : new Set<string>()
        for (const decision of decisions) {
            const key = this.decisionKey(decision.content, decision.scope ?? null)
            if (existingDecisionKeys.has(key)) continue
            const saved = await this.blackboard.writeDecision(group.id, {
                content: decision.content,
                rationale: decision.rationale ?? null,
                scope: decision.scope ?? null,
                createdByAgentId: 'orchestrator',
                status: 'approved',
                approvedBy: userId
            })
            existingDecisionKeys.add(key)
            createdDecisionIds.push(saved.id)
        }
        this.debug.log('group.orchestrator.context_updates.persisted', {
            groupId: group.id,
            runId,
            userId,
            orchestratorSessionId: plan.orchestratorSessionId ?? null,
            projectMetaChanged: groupChanged,
            contextUpdates: updates ?? null,
            createdDecisionIds
        })
    }

    private sameStringArray(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((value, index) => value === b[index])
    }

    private decisionKey(content: string, scope: string | null | undefined): string {
        return `${scope ?? ''}\u0000${content.trim()}`
    }

    private toTaskItemStatus(status: BlackboardTaskNode['status']): TaskItem['status'] {
        if (status === 'doing') return 'in-progress'
        if (status === 'done') return 'done'
        if (status === 'failed') return 'failed'
        if (status === 'blocked') return 'blocked'
        return 'pending'
    }

    /** 聚合各成员产出，生成 text 汇报消息发到 presentation_log + 推 orchestrator_report。 */
    async report(
        group: GroupChat,
        userId: string,
        runId: string,
        outcomes: TaskOutcome[]
    ): Promise<string> {
        const done = outcomes.filter((o) => o.status === 'done').length
        const failed = outcomes.filter((o) => o.status === 'failed')
        const blocked = outcomes.filter((o) => o.status === 'blocked')
        const escalated = outcomes.filter((o) => o.escalation)
        const head =
            outcomes.length === 0
                ? '本轮没有产生任务。'
                : failed.length === 0 && blocked.length === 0
                  ? '本轮任务已全部完成：'
                  : `本轮任务部分完成（${done} 成功 / ${failed.length} 失败 / ${blocked.length} 阻塞）：`
        const icon = (o: TaskOutcome): string =>
            o.status === 'done' ? '✅' : o.status === 'blocked' ? '⏸️' : '❌'
        const lines = outcomes.map((o) => `- ${icon(o)} ${o.name}：${o.summary}`)
        const parts = [head, ...lines]
        if (escalated.length > 0) {
            parts.push('', '⚠️ 需你决策（已停止相关派发，请裁决后重新发起）：')
            for (const o of escalated) {
                parts.push(`- ${o.name}：${o.escalation?.detail ?? o.summary}`)
            }
        }
        const text = parts.join('\n')
        await this.groupMessages.appendText(group.id, userId, 'orchestrator', text)
        await this.runStream.publish(runId, { type: 'orchestrator_report', runId, text })
        this.debug.log('group.orchestrator.report', {
            groupId: group.id,
            runId,
            userId,
            outcomes,
            text
        })
        return text
    }
}
