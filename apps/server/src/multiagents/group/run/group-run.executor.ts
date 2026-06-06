import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import type { ConverseGroupPayload, GroupRouteKind } from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'
import type { Agent } from '../../entities/agent.entity.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupChatService } from '../group-chat.service.js'
import { ContinuityResolver } from '../routing/continuity-resolver.service.js'
import { MessageRouter } from '../routing/message-router.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRun } from '../entities/group-run.entity.js'
import { DispatchService } from './dispatch.service.js'
import { GroupRunStream } from './group-run-stream.service.js'
import { OrchestratorService, type TaskOutcome } from './orchestrator.service.js'

interface MemberPair {
    member: GroupChatMember
    agent: Agent
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
        private readonly blackboard: BlackboardService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly config: ConfigService
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
        let success = true

        try {
            if (routeKind === 'direct_single') {
                success = await this.runDirectSingle(
                    group,
                    userId,
                    runId,
                    mentionedAgentIds[0],
                    userText,
                    byAgent,
                    abort.signal
                )
            } else {
                success = await this.runOrchestrated(
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
            success = false
            this.logger.error(`Group run ${runId} failed: ${this.errMsg(err)}`)
            await this.groupMessages
                .appendSystem(group.id, userId, `群运行出错：${this.errMsg(err)}`)
                .catch(() => undefined)
        } finally {
            const aborted = abort.signal.aborted
            this.runningRuns.delete(runId)
            await this.runRepo
                .update(
                    { id: runId },
                    { status: aborted ? 'aborted' : success ? 'done' : 'failed', endedAt: new Date() }
                )
                .catch(() => undefined)
            await this.runStream.releaseActiveRun(group.id, runId).catch(() => undefined)
            await this.runStream
                .publish(runId, { type: 'done', runId, success: success && !aborted })
                .catch(() => undefined)
            await this.runStream.finalize(runId).catch(() => undefined)
        }
    }

    private async runDirectSingle(
        group: GroupChat,
        userId: string,
        runId: string,
        agentId: string,
        userText: string,
        byAgent: Map<string, MemberPair>,
        signal: AbortSignal
    ): Promise<boolean> {
        const pair = byAgent.get(agentId)
        if (!pair) {
            await this.groupMessages.appendSystem(group.id, userId, `成员 ${agentId} 不在本群。`)
            return false
        }
        const continuity = await this.continuity.resolve(group.id, agentId, userText)
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
        const status = result.success ? 'done' : 'failed'
        await this.blackboard.setTaskStatus(group.id, node.id, status)
        await this.runStream.publish(runId, {
            type: 'task_status',
            runId,
            taskId: node.id,
            status,
            agentId
        })
        return result.success
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
    ): Promise<boolean> {
        const { nodes } = await this.orchestrator.plan({
            group,
            userId,
            runId,
            userText,
            routeKind,
            mentionedAgentIds,
            members
        })

        const outcomes: TaskOutcome[] = []
        let success = true
        for (const node of nodes) {
            if (signal.aborted) {
                success = false
                break
            }
            const pair = node.agentId ? byAgent.get(node.agentId) : undefined
            if (!pair) {
                await this.blackboard.setTaskStatus(group.id, node.id, 'failed')
                outcomes.push({ name: node.name, summary: '无可用成员', success: false })
                success = false
                break
            }
            const continuity = await this.continuity.resolve(group.id, pair.agent.id, node.objective)
            await this.blackboard.setTaskStatus(group.id, node.id, 'doing')
            await this.runStream.publish(runId, {
                type: 'task_status',
                runId,
                taskId: node.id,
                status: 'doing',
                agentId: pair.agent.id
            })
            const result = await this.dispatch.dispatch({
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
            const status = result.success ? 'done' : 'failed'
            await this.blackboard.setTaskStatus(group.id, node.id, status)
            await this.runStream.publish(runId, {
                type: 'task_status',
                runId,
                taskId: node.id,
                status,
                agentId: pair.agent.id
            })
            outcomes.push({ name: node.name, summary: result.summary, success: result.success })
            if (!result.success) {
                success = false
                break // 失败即停止后续派发（最小降级）
            }
        }

        await this.orchestrator.report(group, userId, runId, outcomes)
        return success
    }

    private shorten(text: string): string {
        const t = text.trim().replace(/\s+/g, ' ')
        return t.length > 30 ? `${t.slice(0, 30)}…` : t
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
