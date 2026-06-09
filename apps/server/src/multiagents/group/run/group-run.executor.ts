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
    outcomes?: TaskOutcome[]
}

/** 强制续接成员同一 SDK 会话（用于把用户答复喂回挂起任务）。 */
const RESUME_CONTINUITY: ContinuityResult = {
    case: 'A',
    targetArtifactPaths: [],
    hotContext: null,
    needsOrchestratorJudgement: false
}

/** 引用消息注入目标成员上下文时的免责提示（结论性事实以当前产出物/黑板为准）。 */
const QUOTE_CAVEAT =
    '' +
    '注意：以上为用户引用的历史消息，仅代表引用当时的情况，可能与当前产出物/黑板事实不一致。请以当前产出物与黑板为准，必要时自行重新确认其可靠性。'

/**
 * GroupRunExecutor — 编排一次群运行（一条用户消息）。
 *
 * converse 入口抢群活跃轮锁、写 presentation_log、路由、建 GroupRun，立即返回 runId 并
 * 游离后台执行 runGroup（不 await，与 HTTP 解耦，沿用单聊 turn 范式）。runGroup 按
 * routeKind 串行派发：direct_single 先走 ContinuityResolver；能确定 A/B/C 才直派，
 * 判不了则升级给 Orchestrator。orchestrate/multi 交 Orchestrator 出计划后按 DAG
 * dispatch；若一阶段全部完成，会把阶段产出摘要交回 Orchestrator 做有限续编排，
 * 避免"先产品规划、再前端实现"这类多阶段需求在规划完成后提前收尾。
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
        if (group.status === 'archived' || group.archivedAt) {
            throw BusinessException.forbidden('Archived group chat is read-only')
        }

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
            await this.groupMessages.appendText(
                group.id,
                userId,
                'user',
                text,
                null,
                payload.replyTo ?? null
            )
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

        // 引用：按 messageId 取 presentation_log 完整原文（不信任 client excerpt），
        // 拼成带免责提示的引用前言折进 userText，使其贯穿路由判定/编排/派发到目标成员上下文。
        const userText = await this.buildQuotedUserText(group.id, text, payload.replyTo)

        void this.runGroup({
            group,
            userId,
            runId,
            routeKind: route.routeKind,
            mentionedAgentIds: route.mentionedAgentIds,
            userText,
            members: membersWithAgents
        })
        return { runId }
    }

    /**
     * 引用前言装配：用户引用某历史消息时，把被引用消息原文 + 免责提示作为前言拼到本条消息前。
     * 原文以服务端 presentation_log 为准（按 messageId 取，归属于本群）；取不到时回退 client excerpt。
     * 无引用则原样返回。
     */
    private async buildQuotedUserText(
        groupId: string,
        text: string,
        replyTo: ConverseGroupPayload['replyTo']
    ): Promise<string> {
        if (!replyTo?.messageId) return text
        const resolved = await this.groupMessages
            .getMessageText(groupId, replyTo.messageId)
            .catch(() => null)
        const quoted = (resolved ?? replyTo.excerpt ?? '').trim()
        if (!quoted) return text
        const sender = replyTo.senderName?.trim() || '未知'
        return [
            `<quoted_message sender="${sender}">`,
            quoted,
            '</quoted_message>',
            QUOTE_CAVEAT,
            '',
            text
        ].join('\n')
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
                    { node: resume.node, answerText: userText },
                    { originalUserText: userText }
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
    ): Promise<
        { node: BlackboardTaskNode; graphNodes: BlackboardTaskNode[] } | 'ambiguous' | null
    > {
        const waiting = await this.blackboard.listWaitingTasks(group.id)
        if (waiting.length === 0) return null

        let target: (typeof waiting)[number] | null = null
        if (waiting.length === 1) {
            const only = waiting[0]
            const mentionsOnly = !!only.agentId && mentionedAgentIds.includes(only.agentId)
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
        const reviewed = await this.reviewDispatchResult(
            group,
            userId,
            runId,
            userText,
            node,
            pair,
            result,
            [],
            signal
        )
        const status: BlackboardTaskStatus = reviewed.suspended
            ? 'waiting_input'
            : reviewed.success
              ? 'done'
              : 'failed'
        await this.blackboard.setTaskStatus(group.id, node.id, status)
        await this.runStream.publish(runId, {
            type: 'task_status',
            runId,
            taskId: node.id,
            status,
            agentId,
            summary: reviewed.summary
        })
        return { success: reviewed.success, suspended: !!reviewed.suspended }
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
        const allOutcomes: TaskOutcome[] = []
        const maxStages = this.maxOrchestrationStages()
        let stage = 0
        let reviewContinuationAttempts = 0
        let nextUserText = userText
        let nextRouteKind = routeKind
        let nextMentionedAgentIds = mentionedAgentIds

        while (!signal.aborted && stage < maxStages) {
            const continuation = stage > 0
            const { nodes, memberTurns } = await this.orchestrator.plan({
                group,
                userId,
                runId,
                userText: nextUserText,
                routeKind: nextRouteKind,
                mentionedAgentIds: nextMentionedAgentIds,
                members,
                suppressNoopMessage: continuation
            })
            this.debug.log('group.run.orchestrated.nodes', {
                groupId: group.id,
                runId,
                routeKind: nextRouteKind,
                mentionedAgentIds: nextMentionedAgentIds,
                userText: nextUserText,
                stage,
                continuation,
                nodes,
                memberTurns
            })

            if (memberTurns.length > 0) {
                const memberPhase = await this.runMemberTurns(
                    group,
                    userId,
                    runId,
                    memberTurns,
                    byAgent,
                    signal
                )
                const report = await this.reportIfNeeded(group, userId, runId, allOutcomes, {
                    originalUserText: userText,
                    reviewFinal: allOutcomes.length > 0,
                    emitIncompleteReview: true
                })
                return {
                    success:
                        memberPhase.success &&
                        !signal.aborted &&
                        !report?.shouldContinue &&
                        allOutcomes.every((o) => o.status === 'done'),
                    suspended: memberPhase.suspended,
                    outcomes: allOutcomes
                }
            }

            if (nodes.length === 0) {
                const canAttemptReviewFollowUp =
                    reviewContinuationAttempts < maxStages && stage < maxStages
                const report = await this.reportIfNeeded(group, userId, runId, allOutcomes, {
                    originalUserText: userText,
                    reviewFinal: allOutcomes.length > 0,
                    emitIncompleteReview: !canAttemptReviewFollowUp
                })
                if (
                    report?.shouldContinue &&
                    report.followUpInstruction &&
                    canAttemptReviewFollowUp
                ) {
                    reviewContinuationAttempts += 1
                    nextUserText = this.buildFinalReviewContinuationPrompt(
                        userText,
                        report.followUpInstruction,
                        allOutcomes
                    )
                    nextRouteKind = 'orchestrate'
                    nextMentionedAgentIds = []
                    this.debug.log('group.run.orchestrated.review_follow_up', {
                        groupId: group.id,
                        runId,
                        stage,
                        reviewContinuationAttempts,
                        followUpInstruction: report.followUpInstruction,
                        review: report.review ?? null
                    })
                    continue
                }
                return {
                    success:
                        !signal.aborted &&
                        !report?.shouldContinue &&
                        allOutcomes.every((o) => o.status === 'done'),
                    suspended: false,
                    outcomes: allOutcomes
                }
            }

            const stagePhase = await this.drive(
                group,
                userId,
                runId,
                nodes,
                byAgent,
                signal,
                undefined,
                {
                    report: false,
                    originalUserText: userText
                }
            )
            allOutcomes.push(...(stagePhase.outcomes ?? []))
            if (!stagePhase.success || stagePhase.suspended) {
                if (!stagePhase.suspended) {
                    await this.reportIfNeeded(group, userId, runId, allOutcomes, {
                        originalUserText: userText,
                        reviewFinal: false
                    })
                }
                return {
                    ...stagePhase,
                    outcomes: allOutcomes
                }
            }

            stage += 1
            if (stage >= maxStages) {
                this.debug.log('group.run.orchestrated.max_stages_reached', {
                    groupId: group.id,
                    runId,
                    maxStages,
                    outcomes: allOutcomes
                })
                break
            }
            nextUserText = this.buildContinuationPrompt(
                userText,
                stage,
                stagePhase.outcomes ?? [],
                allOutcomes
            )
            nextRouteKind = 'orchestrate'
            nextMentionedAgentIds = []
        }

        const report = await this.reportIfNeeded(group, userId, runId, allOutcomes, {
            originalUserText: userText,
            reviewFinal: allOutcomes.length > 0,
            emitIncompleteReview: true
        })
        return {
            success:
                !signal.aborted &&
                !report?.shouldContinue &&
                allOutcomes.length > 0 &&
                allOutcomes.every((o) => o.status === 'done'),
            suspended: false,
            outcomes: allOutcomes
        }
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
        resume?: { node: BlackboardTaskNode; answerText: string },
        options: { report?: boolean; originalUserText?: string } = {}
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
            agentId: string | null,
            summary?: string
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
                agentId,
                ...(summary ? { summary } : {})
            })
        }

        const failNode = async (
            node: BlackboardTaskNode,
            summary: string,
            escalation: DispatchResult['escalation'],
            agentId: string | null
        ): Promise<void> => {
            await setStatus(node.id, 'failed', agentId, summary)
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
                    agentId: child.agentId ?? null,
                    summary: '上游任务失败，未执行'
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
            await setStatus(node.id, 'waiting_input', agentId, question)
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
                await setStatus(node.id, 'done', agentId, result.summary)
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
            const reviewed = await this.reviewDispatchResult(
                group,
                userId,
                runId,
                options.originalUserText ?? '',
                node,
                pair,
                result,
                [...nodeById.values()],
                signal
            )
            await applyResult(node, reviewed, pair.agent.id)
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
                const reviewed = await this.reviewDispatchResult(
                    group,
                    userId,
                    runId,
                    options.originalUserText ?? resume.answerText,
                    node,
                    pair,
                    result,
                    [...nodeById.values()],
                    signal
                )
                await applyResult(node, reviewed, pair.agent.id)
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
        // 图中只要还有 waiting_input（含本轮新挂起或同图其它未答复任务）→ 本轮按"等待"收尾。
        const anyWaiting = suspended || [...statusById.values()].some((s) => s === 'waiting_input')
        if (options.report !== false && !anyWaiting) {
            await this.orchestrator.report(group, userId, runId, outcomes, {
                originalUserText: options.originalUserText
            })
        }
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
            suspended: anyWaiting && !signal.aborted,
            outcomes
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

    private async reviewDispatchResult(
        group: GroupChat,
        userId: string,
        runId: string,
        originalUserText: string,
        node: BlackboardTaskNode,
        pair: MemberPair,
        result: DispatchResult,
        graphNodes: BlackboardTaskNode[],
        signal: AbortSignal
    ): Promise<DispatchResult> {
        if (!result.success || result.suspended || result.escalation || signal.aborted) {
            return result
        }
        try {
            const downstreamTasks = graphNodes
                .filter((candidate) => candidate.deps.includes(node.id))
                .map((candidate) => ({
                    id: candidate.id,
                    name: candidate.name,
                    objective: candidate.objective,
                    agentId: candidate.agentId,
                    deps: candidate.deps
                }))
            const review = await this.orchestrator.reviewTaskHandoff({
                group,
                userId,
                runId,
                originalUserText: originalUserText || node.objective,
                task: {
                    id: node.id,
                    name: node.name,
                    objective: node.objective,
                    agentId: node.agentId,
                    agentName: pair.agent.name,
                    roleInGroup: pair.member.roleInGroup,
                    capabilitySummary: pair.agent.capabilitySummary ?? null,
                    summary: result.rawOutput?.trim() || result.summary
                },
                downstreamTasks
            })
            if (review.awaitingUserInput) {
                const question = review.question?.trim() || result.summary
                this.debug.log('group.run.task_handoff.waiting_input', {
                    groupId: group.id,
                    runId,
                    taskId: node.id,
                    agentId: pair.agent.id,
                    question,
                    reason: review.reason
                })
                return {
                    ...result,
                    success: false,
                    summary: question,
                    suspended: { question }
                }
            }
            if (!review.completed) {
                const summary = review.reason || 'Orchestrator 判断该任务尚未完成'
                this.debug.log('group.run.task_handoff.incomplete', {
                    groupId: group.id,
                    runId,
                    taskId: node.id,
                    agentId: pair.agent.id,
                    summary,
                    review
                })
                return {
                    ...result,
                    success: false,
                    summary
                }
            }
        } catch (err) {
            this.debug.log('group.run.task_handoff.review_failed', {
                groupId: group.id,
                runId,
                taskId: node.id,
                agentId: pair.agent.id,
                error: this.errMsg(err)
            })
        }
        return result
    }

    private maxParallelTasks(): number {
        const raw = Number(this.config.get<string>('GROUP_MAX_PARALLEL_TASKS', '3'))
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3
    }

    private maxOrchestrationStages(): number {
        const raw = Number(this.config.get<string>('GROUP_MAX_ORCHESTRATION_STAGES', '4'))
        return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4
    }

    private async reportIfNeeded(
        group: GroupChat,
        userId: string,
        runId: string,
        outcomes: TaskOutcome[],
        options: {
            originalUserText?: string
            reviewFinal?: boolean
            emitIncompleteReview?: boolean
        } = {}
    ): Promise<Awaited<ReturnType<OrchestratorService['report']>> | null> {
        if (outcomes.length === 0) return null
        return this.orchestrator.report(group, userId, runId, outcomes, options)
    }

    private buildContinuationPrompt(
        originalUserText: string,
        completedStage: number,
        stageOutcomes: TaskOutcome[],
        allOutcomes: TaskOutcome[]
    ): string {
        const render = (outcomes: TaskOutcome[]): string =>
            outcomes.length === 0
                ? '- (无)'
                : outcomes.map((o) => `- [${o.status}] ${o.name}：${o.summary}`).join('\n')
        return [
            '# 内部续编排检查',
            `原始用户需求：${originalUserText}`,
            `刚完成的阶段序号：${completedStage}`,
            `刚完成的阶段结果：\n${render(stageOutcomes)}`,
            `本轮已完成/已处理的全部任务：\n${render(allOutcomes)}`,
            '',
            '请结合黑板摘要、已完成任务和成员能力判断原始用户需求是否已经真正交付。',
            '如果原始需求需要创建/修改文件、实现功能、产出文档或执行检查，而刚完成的阶段只是需求梳理、PRD、方案、设计确认或调研，请继续创建下游成员 tasks，通常应派给能实际交付的成员（例如前端工程师）。',
            '只为尚未完成的后续工作创建 tasks，避免重复已经完成的任务；若原始需求已完全满足，返回 tasks:[]。'
        ].join('\n')
    }

    private buildFinalReviewContinuationPrompt(
        originalUserText: string,
        followUpInstruction: string,
        allOutcomes: TaskOutcome[]
    ): string {
        const outcomes = allOutcomes
            .map((o) => `- [${o.status}] ${o.name}：${o.summary}`)
            .join('\n')
        return [
            '# 最终验收未通过，继续完成缺口',
            `原始用户需求：${originalUserText}`,
            `验收提出的后续指令：${followUpInstruction}`,
            `本轮已完成/已处理的任务：\n${outcomes || '- (无)'}`,
            '',
            '请根据验收缺口继续创建成员 tasks。不要重复已经完成且验收通过的工作。'
        ].join('\n')
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
                await this.groupMessages.appendSystem(
                    group.id,
                    userId,
                    `成员 ${turn.agentId} 不在本群。`
                )
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
