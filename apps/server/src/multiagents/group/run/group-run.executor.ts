import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import type {
    BlackboardTaskNode,
    BlackboardTaskStatus,
    ConverseGroupPayload,
    GroupRouteKind,
    TaskItem
} from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'
import type { Agent } from '../../entities/agent.entity.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupChatService } from '../group-chat.service.js'
import {
    ContinuityResolver,
    type ContinuityResult
} from '../routing/continuity-resolver.service.js'
import { MessageRouter } from '../routing/message-router.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRun } from '../entities/group-run.entity.js'
import { DispatchService, type DispatchResult } from './dispatch.service.js'
import { MemberChatService } from './member-chat.service.js'
import { GroupRunStream } from './group-run-stream.service.js'
import { OrchestratorService, type TaskOutcome } from './orchestrator.service.js'
import { computeReady, markDownstreamBlocked } from './task-scheduler.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

interface MemberPair {
    member: GroupChatMember
    agent: Agent
}

/** 一次群运行某阶段的结果：success=全部完成；suspended=有成员挂起等待用户答复（非失败）。 */
interface RunPhaseResult {
    success: boolean
    suspended: boolean
}

/** 强制续接成员同一 SDK 会话（用于把用户答复喂回挂起任务）。 */
const RESUME_CONTINUITY: ContinuityResult = {
    case: 'A',
    targetArtifactPaths: [],
    hotContext: null,
    needsOrchestratorJudgement: false
}

/**
 * GroupRunExecutor — 编排一次群运行（一条用户消息）。
 *
 * converse 入口抢群活跃轮锁、写 presentation_log、路由、建 GroupRun，立即返回 runId 并
 * 游离后台执行 runGroup（不 await，与 HTTP 解耦，沿用单聊 turn 范式）。runGroup 按
 * routeKind 串行派发：direct_single 先走 ContinuityResolver；能确定 A/B/C 才直派，
 * 判不了则升级给 Orchestrator。orchestrate/multi 交 Orchestrator 出计划后逐个
 * dispatch；失败即如实汇报并停止后续。
 */
@Injectable()
export class GroupRunExecutor implements OnModuleInit {
    private readonly logger = new Logger(GroupRunExecutor.name)
    private readonly runningRuns = new Map<string, AbortController>()

    constructor(
        @InjectRepository(GroupRun)
        private readonly runRepo: Repository<GroupRun>,
        private readonly groupChat: GroupChatService,
        private readonly router: MessageRouter,
        private readonly continuity: ContinuityResolver,
        private readonly orchestrator: OrchestratorService,
        private readonly dispatch: DispatchService,
        private readonly memberChat: MemberChatService,
        private readonly blackboard: BlackboardService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly config: ConfigService,
        private readonly debug: GroupDebugLogger
    ) {}

    onModuleInit(): void {
        this.runStream.onAbortRequest((runId) => {
            this.runningRuns.get(runId)?.abort()
        })
        if (this.config.get<string>('GROUP_RECLAIM_ON_BOOT', 'true') !== 'false') {
            void this.runStream
                .reclaimStaleActiveRuns()
                .then((n) => {
                    if (n > 0) this.logger.log(`Reclaimed ${n} stale group run(s) on boot`)
                })
                .catch((err) =>
                    this.logger.error(`Failed to reclaim stale group runs: ${this.errMsg(err)}`)
                )
        }
    }

    /** converse 入口：抢锁 + 写原文 + 路由 + 建 run + 游离执行，返回 runId。 */
    async startRun(
        userId: string,
        groupId: string,
        payload: ConverseGroupPayload
    ): Promise<{ runId: string }> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        const text = payload.text?.trim()
        if (!text) throw BusinessException.badRequest('Message text cannot be empty')

        const runId = randomUUID()
        const owned = await this.runStream.acquireActiveRun(group.id, runId)
        if (owned !== runId) {
            throw BusinessException.conflict(
                `Group ${group.id} already has an active run ${owned}; subscribe to it instead`,
                { reason: 'GROUP_BUSY', activeRunId: owned }
            )
        }

        const membersWithAgents = await this.groupChat.listMembersWithAgents(group.id)
        const route = this.router.route(
            text,
            payload.mentions,
            membersWithAgents.map(({ agent }) => ({ agentId: agent.id, name: agent.name }))
        )
        this.debug.log('group.run.user_input', {
            groupId: group.id,
            runId,
            userId,
            text,
            mentions: payload.mentions ?? [],
            members: membersWithAgents.map(({ member, agent }) => ({
                agentId: agent.id,
                name: agent.name,
                vendor: agent.vendor,
                model: agent.model,
                roleInGroup: member.roleInGroup,
                agentSessionId: member.agentSessionId
            })),
            route
        })

        try {
            await this.groupMessages.appendText(group.id, userId, 'user', text)
            await this.runRepo.save(
                this.runRepo.create({
                    id: runId,
                    userId,
                    groupChatId: group.id,
                    status: 'running',
                    routeKind: route.routeKind,
                    userText: text
                })
            )
        } catch (err) {
            await this.runStream.abandonRun(group.id, runId)
            throw err
        }

        void this.runGroup({
            group,
            userId,
            runId,
            routeKind: route.routeKind,
            mentionedAgentIds: route.mentionedAgentIds,
            userText: text,
            members: membersWithAgents
        })
        return { runId }
    }

    async abortRun(userId: string, groupId: string, runId: string): Promise<{ aborted: true }> {
        await this.groupChat.loadGroup(userId, groupId)
        if (!(await this.runStream.isRunInGroup(groupId, runId))) {
            throw BusinessException.notFound(`Run ${runId} does not belong to group ${groupId}`)
        }
        this.runningRuns.get(runId)?.abort()
        await this.runStream.requestAbort(runId)
        return { aborted: true }
    }

    private async runGroup(params: {
        group: GroupChat
        userId: string
        runId: string
        routeKind: GroupRouteKind
        mentionedAgentIds: string[]
        userText: string
        members: MemberPair[]
    }): Promise<void> {
        const { group, userId, runId, routeKind, mentionedAgentIds, userText, members } = params
        const abort = new AbortController()
        this.runningRuns.set(runId, abort)
        const byAgent = new Map(members.map((p) => [p.agent.id, p]))
        let phase: RunPhaseResult = { success: true, suspended: false }
        this.debug.log('group.run.started', {
            groupId: group.id,
            runId,
            userId,
            routeKind,
            mentionedAgentIds,
            userText,
            members: members.map(({ member, agent }) => ({
                agentId: agent.id,
                name: agent.name,
                roleInGroup: member.roleInGroup
            }))
        })

        try {
            // 恢复优先：本群存在挂起任务且本条消息构成对其的答复 → 恢复该任务，跳过常规路由。
            const resume = await this.resolveResume(group, userId, mentionedAgentIds, byAgent)
            if (resume === 'ambiguous') {
                phase = { success: true, suspended: false }
            } else if (resume) {
                // 用户回复即作为答复 → 把对应提问卡片标记已作答（刷新后置灰），再恢复任务。
                await this.groupMessages
                    .markAgentQuestionAnswered(group.id, resume.node.id, userText)
                    .catch(() => undefined)
                phase = await this.drive(
                    group,
                    userId,
                    runId,
                    resume.graphNodes,
                    byAgent,
                    abort.signal,
                    { node: resume.node, answerText: userText }
                )
            } else if (routeKind === 'direct_single') {
                phase = await this.runDirectSingle(
                    group,
                    userId,
                    runId,
                    mentionedAgentIds[0],
                    userText,
                    byAgent,
                    abort.signal
                )
            } else {
                phase = await this.runOrchestrated(
                    group,
                    userId,
                    runId,
                    routeKind,
                    mentionedAgentIds,
                    userText,
                    members,
                    byAgent,
                    abort.signal
                )
            }
        } catch (err) {
            phase = { success: false, suspended: false }
            this.logger.error(`Group run ${runId} failed: ${this.errMsg(err)}`)
            await this.groupMessages
                .appendSystem(group.id, userId, `群运行出错：${this.errMsg(err)}`)
                .catch(() => undefined)
        } finally {
            const aborted = abort.signal.aborted
            const suspended = phase.suspended && !aborted
            this.runningRuns.delete(runId)
            await this.runRepo
                .update(
                    { id: runId },
                    {
                        status: aborted
                            ? 'aborted'
                            : suspended
                              ? 'waiting'
                              : phase.success
                                ? 'done'
                                : 'failed',
                        endedAt: new Date()
                    }
                )
                .catch(() => undefined)
            await this.runStream.releaseActiveRun(group.id, runId).catch(() => undefined)
            // 挂起不是失败：done 事件按"非失败"上报，避免前端把"等待回复"渲染成错误。
            await this.runStream
                .publish(runId, {
                    type: 'done',
                    runId,
                    success: (phase.success || suspended) && !aborted
                })
                .catch(() => undefined)
            await this.runStream.finalize(runId).catch(() => undefined)
            this.debug.log('group.run.finished', {
                groupId: group.id,
                runId,
                userId,
                success: phase.success,
                suspended,
                aborted,
                finalSuccess: (phase.success || suspended) && !aborted
            })
        }
    }

    /**
     * 恢复判定：本群是否存在 waiting_input 任务，且本条消息构成对它的答复。
     * - 0 个挂起 → null（正常流程）。
     * - 1 个挂起：无 @mention 或 @ 的正是该成员 → 恢复；@ 了别人 → null（留逃生口当新请求）。
     * - 多个挂起：仅当 @ 命中某挂起任务的成员才恢复那一个；否则提示用户 @对应成员（返回 'ambiguous'）。
     */
    private async resolveResume(
        group: GroupChat,
        userId: string,
        mentionedAgentIds: string[],
        byAgent: Map<string, MemberPair>
    ): Promise<{ node: BlackboardTaskNode; graphNodes: BlackboardTaskNode[] } | 'ambiguous' | null> {
        const waiting = await this.blackboard.listWaitingTasks(group.id)
        if (waiting.length === 0) return null

        let target: (typeof waiting)[number] | null = null
        if (waiting.length === 1) {
            const only = waiting[0]
            const mentionsOnly =
                !!only.agentId && mentionedAgentIds.includes(only.agentId)
            if (mentionedAgentIds.length === 0 || mentionsOnly) target = only
        } else {
            target =
                waiting.find((t) => !!t.agentId && mentionedAgentIds.includes(t.agentId)) ?? null
            if (!target) {
                const names = waiting
                    .map((t) => (t.agentId ? byAgent.get(t.agentId)?.agent.name : null))
                    .filter((n): n is string => !!n)
                await this.groupMessages.appendSystem(
                    group.id,
                    userId,
                    `当前有多个成员在等待你的回复（${names.join('、')}）。请 @对应成员 再回复，以便恢复对应任务。`
                )
                this.debug.log('group.run.resume.ambiguous', {
                    groupId: group.id,
                    waitingTaskIds: waiting.map((t) => t.id),
                    mentionedAgentIds
                })
                return 'ambiguous'
            }
        }
        if (!target || !target.runId) return null

        const graphNodes = await this.blackboard.listTasksByRunId(group.id, target.runId)
        const node = graphNodes.find((n) => n.id === target.id)
        if (!node) return null
        this.debug.log('group.run.resume.resolved', {
            groupId: group.id,
            taskId: node.id,
            agentId: node.agentId,
            graphRunId: target.runId,
            graphSize: graphNodes.length
        })
        return { node, graphNodes }
    }

    private async runDirectSingle(
        group: GroupChat,
        userId: string,
        runId: string,
        agentId: string,
        userText: string,
        byAgent: Map<string, MemberPair>,
        signal: AbortSignal
    ): Promise<RunPhaseResult> {
        const pair = byAgent.get(agentId)
        if (!pair) {
            this.debug.log('group.run.direct_single.missing_member', {
                groupId: group.id,
                runId,
                agentId,
                userText
            })
            await this.groupMessages.appendSystem(group.id, userId, `成员 ${agentId} 不在本群。`)
            return { success: false, suspended: false }
        }
        const continuity = await this.continuity.resolve(group.id, agentId, userText)
        this.debug.log('group.run.direct_single.decision', {
            groupId: group.id,
            runId,
            agentId,
            userText,
            continuity
        })
        if (continuity.needsOrchestratorJudgement) {
            await this.groupMessages.appendSystem(
                group.id,
                userId,
                '指代或目标不够明确，已交由 Orchestrator 重新判断并分派。'
            )
            await this.runRepo.update({ id: runId }, { routeKind: 'orchestrate' })
            return this.runOrchestrated(
                group,
                userId,
                runId,
                'orchestrate',
                [agentId],
                userText,
                [...byAgent.values()],
                byAgent,
                signal
            )
        }
        const [node] = await this.blackboard.upsertTaskGraph(group.id, runId, [
            {
                key: 't1',
                name: this.shorten(userText),
                agentId,
                deps: [],
                objective: userText,
                status: 'doing'
            }
        ])
        this.debug.log('group.run.direct_single.task_created', {
            groupId: group.id,
            runId,
            task: node
        })
        await this.runStream.publish(runId, {
            type: 'task_status',
            runId,
            taskId: node.id,
            status: 'doing',
            agentId
        })
        const result = await this.dispatch.dispatch({
            group,
            userId,
            runId,
            taskId: node.id,
            taskName: node.name,
            objective: userText,
            agent: pair.agent,
            member: pair.member,
            continuity,
            signal
        })
        const status: BlackboardTaskStatus = result.suspended
            ? 'waiting_input'
            : result.success
              ? 'done'
              : 'failed'
        await this.blackboard.setTaskStatus(group.id, node.id, status)
        await this.runStream.publish(runId, {
            type: 'task_status',
            runId,
            taskId: node.id,
            status,
            agentId
        })
        return { success: result.success, suspended: !!result.suspended }
    }

    private async runOrchestrated(
        group: GroupChat,
        userId: string,
        runId: string,
        routeKind: GroupRouteKind,
        mentionedAgentIds: string[],
        userText: string,
        members: MemberPair[],
        byAgent: Map<string, MemberPair>,
        signal: AbortSignal
    ): Promise<RunPhaseResult> {
        const { nodes, memberTurns } = await this.orchestrator.plan({
            group,
            userId,
            runId,
            userText,
            routeKind,
            mentionedAgentIds,
            members
        })
        this.debug.log('group.run.orchestrated.nodes', {
            groupId: group.id,
            runId,
            routeKind,
            mentionedAgentIds,
            userText,
            nodes,
            memberTurns
        })
        if (memberTurns.length > 0) {
            return this.runMemberTurns(group, userId, runId, memberTurns, byAgent, signal)
        }
        if (nodes.length === 0) return { success: true, suspended: false }

        return this.drive(group, userId, runId, nodes, byAgent, signal)
    }

    /**
     * DAG 并行调度：按 deps 计算就绪集并发派发（上限 GROUP_MAX_PARALLEL_TASKS，默认 3），
     * 同一 Agent 不并发双开（共享 AgentSession.workingDirectory）。单任务失败重试 1 次；
     * 仍失败 → 标 failed 并把其传递下游标 blocked，互不依赖任务继续；遇冲突（escalation）
     * 同样计 failed + 阻塞下游，最终由 orchestrator.report 在汇报里列出"需你决策"。
     *
     * 成员主动挂起（suspended）→ 计 waiting_input：既不算完成、也不算失败，故下游 deps（≠done）
     * 不满足、自然不就绪（不放行）；也不调 markDownstreamBlocked（不阻塞）。
     *
     * resume 存在时：先把用户答复（answerText）在同一 SDK 会话喂回挂起任务，完成后再进入常规循环
     * 释放其下游。
     */
    private async drive(
        group: GroupChat,
        userId: string,
        runId: string,
        nodes: BlackboardTaskNode[],
        byAgent: Map<string, MemberPair>,
        signal: AbortSignal,
        resume?: { node: BlackboardTaskNode; answerText: string }
    ): Promise<RunPhaseResult> {
        const maxParallel = this.maxParallelTasks()
        const statusById = new Map<string, BlackboardTaskStatus>(nodes.map((n) => [n.id, n.status]))
        const nodeById = new Map(nodes.map((n) => [n.id, n]))
        const outcomesById = new Map<string, TaskOutcome>()
        const busyAgents = new Set<string>()
        const inFlight = new Map<string, Promise<void>>()
        let suspended = false

        const setStatus = async (
            taskId: string,
            status: BlackboardTaskStatus,
            agentId: string | null
        ): Promise<void> => {
            statusById.set(taskId, status)
            await this.blackboard.setTaskStatus(group.id, taskId, status)
            await this.groupMessages.updateTaskListTaskStatus(
                group.id,
                taskId,
                this.toTaskItemStatus(status)
            )
            await this.runStream.publish(runId, {
                type: 'task_status',
                runId,
                taskId,
                status,
                agentId
            })
        }

        const failNode = async (
            node: BlackboardTaskNode,
            summary: string,
            escalation: DispatchResult['escalation'],
            agentId: string | null
        ): Promise<void> => {
            await setStatus(node.id, 'failed', agentId)
            outcomesById.set(node.id, {
                name: node.name,
                summary,
                success: false,
                status: 'failed',
                ...(escalation ? { escalation } : {})
            })
            const blockedIds = markDownstreamBlocked([...nodeById.values()], node.id, statusById)
            for (const id of blockedIds) {
                const child = nodeById.get(id)
                if (!child) continue
                await this.blackboard.setTaskStatus(group.id, id, 'blocked')
                await this.groupMessages.updateTaskListTaskStatus(group.id, id, 'blocked')
                await this.runStream.publish(runId, {
                    type: 'task_status',
                    runId,
                    taskId: id,
                    status: 'blocked',
                    agentId: child.agentId ?? null
                })
                outcomesById.set(id, {
                    name: child.name,
                    summary: '上游任务失败，未执行',
                    success: false,
                    status: 'blocked'
                })
            }
            this.debug.log('group.run.orchestrated.task_failed', {
                groupId: group.id,
                runId,
                taskId: node.id,
                summary,
                escalation,
                blockedDownstream: blockedIds
            })
        }

        const recordSuspended = async (
            node: BlackboardTaskNode,
            question: string,
            agentId: string | null,
            hasQuestionCard = false
        ): Promise<void> => {
            suspended = true
            await setStatus(node.id, 'waiting_input', agentId)
            outcomesById.set(node.id, {
                name: node.name,
                summary: question,
                success: false,
                status: 'waiting_input',
                question,
                ...(hasQuestionCard ? { hasQuestionCard } : {})
            })
            this.debug.log('group.run.orchestrated.task_suspended', {
                groupId: group.id,
                runId,
                taskId: node.id,
                question
            })
        }

        const applyResult = async (
            node: BlackboardTaskNode,
            result: DispatchResult,
            agentId: string | null
        ): Promise<void> => {
            if (result.suspended) {
                await recordSuspended(
                    node,
                    result.suspended.question,
                    agentId,
                    result.suspended.hasQuestionCard === true
                )
            } else if (result.success) {
                await setStatus(node.id, 'done', agentId)
                outcomesById.set(node.id, {
                    name: node.name,
                    summary: result.summary,
                    success: true,
                    status: 'done'
                })
            } else {
                await failNode(node, result.summary, result.escalation, agentId)
            }
        }

        const runOne = async (node: BlackboardTaskNode): Promise<void> => {
            const pair = node.agentId ? byAgent.get(node.agentId) : undefined
            if (!pair) {
                this.debug.log('group.run.orchestrated.missing_member', {
                    groupId: group.id,
                    runId,
                    task: node
                })
                await failNode(node, '无可用成员', undefined, node.agentId ?? null)
                return
            }
            await setStatus(node.id, 'doing', pair.agent.id)
            const result = await this.dispatchWithRetry(group, userId, runId, node, pair, signal)
            await applyResult(node, result, pair.agent.id)
        }

        // 恢复：先在同一 SDK 会话里把用户答复喂回挂起任务（强制 Case A），完成后再走常规调度释放下游。
        if (resume) {
            const node = resume.node
            const pair = node.agentId ? byAgent.get(node.agentId) : undefined
            if (!pair) {
                await failNode(node, '挂起任务的成员已不在群', undefined, node.agentId ?? null)
            } else {
                await setStatus(node.id, 'doing', pair.agent.id)
                this.debug.log('group.run.resume.dispatch', {
                    groupId: group.id,
                    runId,
                    taskId: node.id,
                    agentId: pair.agent.id,
                    answerText: resume.answerText
                })
                const result = await this.dispatch.dispatch({
                    group,
                    userId,
                    runId,
                    taskId: node.id,
                    taskName: node.name,
                    objective: resume.answerText,
                    agent: pair.agent,
                    member: pair.member,
                    continuity: RESUME_CONTINUITY,
                    signal
                })
                await applyResult(node, result, pair.agent.id)
            }
        }

        while (!signal.aborted) {
            for (const node of computeReady(nodes, statusById)) {
                if (inFlight.size >= maxParallel) break
                if (node.agentId && busyAgents.has(node.agentId)) continue
                if (node.agentId) busyAgents.add(node.agentId)
                statusById.set(node.id, 'doing') // 同步占位，防同一轮重复挑选
                const p = (async () => {
                    try {
                        await runOne(node)
                    } finally {
                        if (node.agentId) busyAgents.delete(node.agentId)
                        inFlight.delete(node.id)
                    }
                })()
                inFlight.set(node.id, p)
            }
            if (inFlight.size === 0) break
            await Promise.race(inFlight.values())
        }
        await Promise.allSettled([...inFlight.values()])

        const outcomes = nodes
            .map((n) => outcomesById.get(n.id))
            .filter((o): o is TaskOutcome => o !== undefined)
        await this.orchestrator.report(group, userId, runId, outcomes)
        // 图中只要还有 waiting_input（含本轮新挂起或同图其它未答复任务）→ 本轮按"等待"收尾。
        const anyWaiting =
            suspended || [...statusById.values()].some((s) => s === 'waiting_input')
        this.debug.log('group.run.orchestrated.scheduled', {
            groupId: group.id,
            runId,
            maxParallel,
            aborted: signal.aborted,
            suspended: anyWaiting,
            outcomes
        })
        return {
            success:
                !signal.aborted &&
                !anyWaiting &&
                outcomes.length > 0 &&
                outcomes.every((o) => o.status === 'done'),
            suspended: anyWaiting && !signal.aborted
        }
    }

    /** 派发单任务，失败（非冲突、非挂起、非中止）时重试 1 次。 */
    private async dispatchWithRetry(
        group: GroupChat,
        userId: string,
        runId: string,
        node: BlackboardTaskNode,
        pair: MemberPair,
        signal: AbortSignal
    ): Promise<DispatchResult> {
        const first = await this.dispatchTask(group, userId, runId, node, pair, signal)
        // suspended 是"主动挂起等用户答复"，不是失败，绝不重试（否则会重复建 worktree/分支并报错）。
        if (first.success || first.suspended || first.escalation || signal.aborted) return first
        this.debug.log('group.run.orchestrated.retry', {
            groupId: group.id,
            runId,
            taskId: node.id,
            agentId: pair.agent.id,
            firstSummary: first.summary
        })
        return this.dispatchTask(group, userId, runId, node, pair, signal)
    }

    private async dispatchTask(
        group: GroupChat,
        userId: string,
        runId: string,
        node: BlackboardTaskNode,
        pair: MemberPair,
        signal: AbortSignal
    ): Promise<DispatchResult> {
        const continuity = await this.continuity.resolve(group.id, pair.agent.id, node.objective)
        this.debug.log('group.run.orchestrated.dispatch_decision', {
            groupId: group.id,
            runId,
            task: node,
            agent: {
                agentId: pair.agent.id,
                name: pair.agent.name,
                vendor: pair.agent.vendor,
                model: pair.agent.model,
                roleInGroup: pair.member.roleInGroup
            },
            continuity
        })
        return this.dispatch.dispatch({
            group,
            userId,
            runId,
            taskId: node.id,
            taskName: node.name,
            objective: node.objective,
            agent: pair.agent,
            member: pair.member,
            continuity,
            signal
        })
    }

    private maxParallelTasks(): number {
        const raw = Number(this.config.get<string>('GROUP_MAX_PARALLEL_TASKS', '3'))
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3
    }

    private toTaskItemStatus(status: BlackboardTaskStatus): TaskItem['status'] {
        if (status === 'doing' || status === 'waiting_input') return 'in-progress'
        if (status === 'done') return 'done'
        if (status === 'failed') return 'failed'
        if (status === 'blocked') return 'blocked'
        return 'pending'
    }

    private async runMemberTurns(
        group: GroupChat,
        userId: string,
        runId: string,
        memberTurns: Array<{ agentId: string; instruction: string }>,
        byAgent: Map<string, MemberPair>,
        signal: AbortSignal
    ): Promise<RunPhaseResult> {
        let success = true
        for (const turn of memberTurns) {
            if (signal.aborted) {
                success = false
                break
            }
            const pair = byAgent.get(turn.agentId)
            if (!pair) {
                this.debug.log('group.run.member_turn.missing_member', {
                    groupId: group.id,
                    runId,
                    turn
                })
                await this.groupMessages.appendSystem(group.id, userId, `成员 ${turn.agentId} 不在本群。`)
                success = false
                break
            }
            this.debug.log('group.run.member_turn.dispatch', {
                groupId: group.id,
                runId,
                agent: {
                    agentId: pair.agent.id,
                    name: pair.agent.name,
                    vendor: pair.agent.vendor,
                    model: pair.agent.model,
                    roleInGroup: pair.member.roleInGroup
                },
                instruction: turn.instruction
            })
            const result = await this.memberChat.chat({
                group,
                userId,
                runId,
                instruction: turn.instruction,
                agent: pair.agent,
                member: pair.member,
                signal
            })
            if (!result.success) {
                success = false
                break
            }
        }
        this.debug.log('group.run.member_turns.finished', {
            groupId: group.id,
            runId,
            success
        })
        return { success, suspended: false }
    }

    private shorten(text: string): string {
        const t = text.trim().replace(/\s+/g, ' ')
        return t.length > 30 ? `${t.slice(0, 30)}…` : t
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
