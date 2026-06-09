import { Inject, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import type {
    BlackboardArtifact,
    BlackboardTaskNode,
    DeployManifest,
    GroupRouteKind,
    TaskItem
} from '@agenthub/shared'
import { Repository } from 'typeorm'
import type { Agent } from '../../entities/agent.entity.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import {
    ORCHESTRATOR_PLANNER,
    type OrchestratorExecutor,
    type OrchestratorContext,
    type OrchestratorContextUpdates,
    type PlanMemberTurn
} from './orchestrator-executor.js'
import {
    ORCHESTRATOR_FINAL_REVIEWER,
    type OrchestratorFinalReviewer,
    type OrchestratorFinalReviewResult
} from './orchestrator-final-reviewer.js'
import {
    ORCHESTRATOR_HANDOFF_REVIEWER,
    type OrchestratorTaskHandoffReviewer,
    type OrchestratorTaskHandoffReviewRequest,
    type OrchestratorTaskHandoffReviewResult
} from './orchestrator-handoff-reviewer.js'
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
    /**
     * Internal continuation checks ask the Orchestrator whether more downstream
     * work remains. A noop answer there should not appear as an extra chat
     * message before the final aggregate report.
     */
    suppressNoopMessage?: boolean
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
    status: 'done' | 'failed' | 'blocked' | 'waiting_input'
    /** 存在时表示该任务遇冲突需用户裁决，汇报里单列"需你决策"。 */
    escalation?: DispatchEscalation
    /** status===waiting_input 时，成员抛给用户的问题正文。 */
    question?: string
    /** true 表示成员已经发出可提交的提问卡片，不需要 Orchestrator 再重复提示。 */
    hasQuestionCard?: boolean
}

export interface OrchestratorReportResult {
    text: string
    shouldContinue: boolean
    followUpInstruction?: string
    review?: OrchestratorFinalReviewResult
}

export function buildOrchestratorReportText(outcomes: TaskOutcome[]): string | null {
    const done = outcomes.filter((o) => o.status === 'done').length
    const failed = outcomes.filter((o) => o.status === 'failed')
    const blocked = outcomes.filter((o) => o.status === 'blocked')
    const waiting = outcomes.filter((o) => o.status === 'waiting_input')
    const escalated = outcomes.filter((o) => o.escalation)
    const onlyInteractiveWaiting =
        outcomes.length > 0 &&
        outcomes.length === waiting.length &&
        waiting.every((o) => o.hasQuestionCard)

    if (onlyInteractiveWaiting) return null

    const head =
        outcomes.length === 0
            ? '本轮没有产生任务。'
            : failed.length === 0 && blocked.length === 0 && waiting.length === 0
              ? '本轮任务已全部完成：'
              : `本轮任务部分完成（${done} 成功 / ${failed.length} 失败 / ${blocked.length} 阻塞 / ${waiting.length} 等待回复）：`
    const icon = (o: TaskOutcome): string =>
        o.status === 'done'
            ? '✅'
            : o.status === 'blocked'
              ? '⛔'
              : o.status === 'waiting_input'
                ? '⏸️'
                : '❌'
    const lines = outcomes.map((o) => `- ${icon(o)} ${o.name}：${o.summary}`)
    const parts = [head, ...lines]
    if (waiting.length > 0) {
        parts.push('', '⏸ 正在等待你的回复（依赖它的下游任务已暂停）：')
        for (const o of waiting) {
            parts.push(`- ${o.name}：${o.question ?? o.summary}`)
        }
        parts.push(
            waiting.length > 1 ? '请 @对应成员 回复对应问题以继续。' : '直接回复即可让其继续。'
        )
    }
    if (escalated.length > 0) {
        parts.push('', '⚠️ 需你决策（已停止相关派发，请裁决后重新发起）：')
        for (const o of escalated) {
            parts.push(`- ${o.name}：${o.escalation?.detail ?? o.summary}`)
        }
    }
    return parts.join('\n')
}

/**
 * OrchestratorService — 独立内置编排角色：用群配置 vendor/model + 内置 prompt 产计划
 *（经可注入 OrchestratorExecutor）。任务消息写黑板 task_graph + 发 task-list；
 * 非任务消息只发 Orchestrator 文本回复；成员消息必须来自真实成员 turn。
 * 轻量成员聊天返回 memberTurns，不写黑板 task_graph。
 */
@Injectable()
export class OrchestratorService {
    constructor(
        @Inject(ORCHESTRATOR_PLANNER)
        private readonly executor: OrchestratorExecutor,
        @Inject(ORCHESTRATOR_FINAL_REVIEWER)
        private readonly finalReviewer: OrchestratorFinalReviewer,
        @Inject(ORCHESTRATOR_HANDOFF_REVIEWER)
        private readonly handoffReviewer: OrchestratorTaskHandoffReviewer,
        @InjectRepository(GroupChat)
        private readonly groupRepo: Repository<GroupChat>,
        private readonly blackboard: BlackboardService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger
    ) {}

    /** 生成计划；有任务则写 task_graph + 发 task-list，非任务则只回复文本。 */
    async plan(params: OrchestratorPlanParams): Promise<OrchestratorPlanResult> {
        const {
            group,
            userId,
            runId,
            routeKind,
            mentionedAgentIds,
            members,
            suppressNoopMessage = false
        } = params

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

        const decision = await this.executor.decide({
            group,
            userId,
            userText: params.userText,
            routeKind,
            mentionedAgentIds,
            context
        })
        this.debug.log('group.orchestrator.executor.raw', {
            groupId: group.id,
            runId,
            routeKind,
            mentionedAgentIds,
            plan: decision
        })
        await this.persistPlannerState(group, userId, runId, decision)

        if (decision.tasks.length === 0) {
            const text = decision.displayText?.trim() || decision.note?.trim() || '收到。'
            if (!suppressNoopMessage) {
                await this.groupMessages.appendText(group.id, userId, 'orchestrator', text)
                await this.runStream.publish(runId, {
                    type: 'orchestrator_report',
                    runId,
                    text
                })
            }
            this.debug.log('group.orchestrator.executor.noop', {
                groupId: group.id,
                runId,
                routeKind,
                mentionedAgentIds,
                note: decision.note,
                displayText: decision.displayText ?? null,
                memberTurns: decision.memberTurns ?? [],
                suppressNoopMessage
            })
            return {
                nodes: [],
                note: decision.note,
                ...(decision.displayText ? { displayText: decision.displayText } : {}),
                memberTurns: decision.memberTurns ?? []
            }
        }

        const nodes = await this.blackboard.upsertTaskGraph(
            group.id,
            runId,
            decision.tasks.map((t) => ({
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
            decision.note ?? '任务计划',
            items
        )
        await this.runStream.publish(runId, {
            type: 'orchestrator_plan',
            runId,
            routeKind,
            tasks: nodes
        })
        this.debug.log('group.orchestrator.executor.persisted', {
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
            note: decision.note
        })

        return { nodes, note: decision.note, memberTurns: [] }
    }

    /**
     * 隐藏交接判断：成员声称成功后，确认是否可以释放下游任务。该方法不写 presentation_log、
     * 不推 run stream；若成员用普通文本向用户提问，会返回 awaitingUserInput=true 让 executor
     * 把任务挂起，从而不启动下一个 Agent。
     */
    async reviewTaskHandoff(
        params: OrchestratorTaskHandoffReviewRequest
    ): Promise<OrchestratorTaskHandoffReviewResult> {
        const review = await this.handoffReviewer.review(params)
        this.debug.log('group.orchestrator.handoff_review', {
            groupId: params.group.id,
            runId: params.runId,
            taskId: params.task.id,
            taskName: params.task.name,
            review
        })
        return review
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
        if (
            plan.orchestratorSessionId &&
            group.orchestratorSessionId !== plan.orchestratorSessionId
        ) {
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
        if (status === 'doing' || status === 'waiting_input') return 'in-progress'
        if (status === 'done') return 'done'
        if (status === 'failed') return 'failed'
        if (status === 'blocked') return 'blocked'
        return 'pending'
    }

    /** 聚合各成员产出，优先调用 Orchestrator LLM 验收/确认后再汇报。 */
    async report(
        group: GroupChat,
        userId: string,
        runId: string,
        outcomes: TaskOutcome[],
        options: {
            originalUserText?: string
            reviewFinal?: boolean
            emitIncompleteReview?: boolean
        } = {}
    ): Promise<OrchestratorReportResult> {
        const fallbackText = buildOrchestratorReportText(outcomes)
        const reviewSubject =
            options.originalUserText?.trim() || this.buildFallbackReviewSubject(outcomes)
        const canRunFinalReview = outcomes.length > 0
        const canContinueFromReview =
            options.reviewFinal === true && outcomes.every((o) => o.status === 'done')

        if (canRunFinalReview) {
            try {
                const review = await this.finalReviewer.review({
                    group,
                    userId,
                    runId,
                    originalUserText: reviewSubject,
                    outcomes
                })
                await this.persistReviewerSessionId(group, review)
                if (!review.complete && canContinueFromReview) {
                    const followUpInstruction =
                        review.followUpInstruction ??
                        this.buildFallbackFollowUpInstruction(reviewSubject, review)
                    if (options.emitIncompleteReview === true) {
                        await this.groupMessages.appendText(
                            group.id,
                            userId,
                            'orchestrator',
                            review.summary
                        )
                        await this.runStream.publish(runId, {
                            type: 'orchestrator_report',
                            runId,
                            text: review.summary
                        })
                    }
                    this.debug.log('group.orchestrator.report.review_incomplete', {
                        groupId: group.id,
                        runId,
                        userId,
                        outcomes,
                        review,
                        followUpInstruction
                    })
                    return {
                        text: '',
                        shouldContinue: true,
                        followUpInstruction,
                        review
                    }
                }
                await this.groupMessages.appendText(
                    group.id,
                    userId,
                    'orchestrator',
                    review.summary
                )
                await this.runStream.publish(runId, {
                    type: 'orchestrator_report',
                    runId,
                    text: review.summary
                })
                if (review.complete) {
                    await this.emitDeployCard(group, userId, runId, review.deploy)
                }
                this.debug.log('group.orchestrator.report.review_confirmed', {
                    groupId: group.id,
                    runId,
                    userId,
                    outcomes,
                    review,
                    canContinueFromReview
                })
                return {
                    text: review.summary,
                    shouldContinue: false,
                    review
                }
            } catch (err) {
                this.debug.log('group.orchestrator.report.review_failed', {
                    groupId: group.id,
                    runId,
                    userId,
                    outcomes,
                    error: err instanceof Error ? err.message : String(err)
                })
            }
        }

        if (fallbackText === null) {
            this.debug.log('group.orchestrator.report.skipped', {
                groupId: group.id,
                runId,
                userId,
                reason: 'interactive_waiting_question_card',
                outcomes
            })
            return { text: '', shouldContinue: false }
        }

        await this.groupMessages.appendText(group.id, userId, 'orchestrator', fallbackText)
        await this.runStream.publish(runId, {
            type: 'orchestrator_report',
            runId,
            text: fallbackText
        })
        // 无 final review（或其失败）时降级：仅当产物里有可直接预览的入口文件才出静态卡。
        await this.emitDeployCard(group, userId, runId, null)
        this.debug.log('group.orchestrator.report.fallback', {
            groupId: group.id,
            runId,
            userId,
            outcomes,
            text: fallbackText
        })
        return { text: fallbackText, shouldContinue: false }
    }

    /**
     * 在总结之后、done 之前发部署卡片：把 manifest + 可预览产物落一张 deploy 卡片并广播
     * deploy_card 事件。manifest 为 null 时降级探测一个静态入口文件（index.html）；探测不到
     * 则不出卡。任何异常只记录、不影响 run 收尾。
     */
    private async emitDeployCard(
        group: GroupChat,
        userId: string,
        runId: string,
        manifest: DeployManifest | null
    ): Promise<void> {
        try {
            const state = await this.blackboard.getState(group.id)
            const artifacts = state.artifacts.filter(
                (a) => a.status !== 'deprecated' && !this.isHiddenArtifact(a.path)
            )
            const resolved = manifest
                ? this.normalizeDeployManifest(manifest, artifacts)
                : this.detectStaticManifest(artifacts)
            if (!resolved) return
            const cardArtifacts = this.selectCardArtifacts(resolved, artifacts)
            await this.groupMessages.appendDeploy(group.id, userId, resolved, cardArtifacts)
            await this.runStream.publish(runId, {
                type: 'deploy_card',
                runId,
                manifest: resolved,
                artifacts: cardArtifacts
            })
            this.debug.log('group.orchestrator.deploy_card', {
                groupId: group.id,
                runId,
                userId,
                manifest: resolved,
                artifactCount: cardArtifacts.length
            })
        } catch (err) {
            this.debug.log('group.orchestrator.deploy_card.failed', {
                groupId: group.id,
                runId,
                error: err instanceof Error ? err.message : String(err)
            })
        }
    }

    /** 降级探测：产物里存在 index.html 时构造一张 static 卡（否则不出卡）。 */
    private detectStaticManifest(artifacts: BlackboardArtifact[]): DeployManifest | null {
        const entry = artifacts.find((a) => {
            const name =
                a.path
                    .split(/[\\/]+/)
                    .pop()
                    ?.toLowerCase() ?? ''
            return name === 'index.html'
        })
        return entry ? { mode: 'static', entryPath: entry.path } : null
    }

    private normalizeDeployManifest(
        manifest: DeployManifest,
        artifacts: BlackboardArtifact[]
    ): DeployManifest | null {
        if (manifest.mode === 'static') {
            const entryPath = manifest.entryPath?.trim()
            if (!entryPath || !artifacts.some((artifact) => artifact.path === entryPath))
                return null
            const note = manifest.note?.trim()
            return { mode: 'static', entryPath, ...(note ? { note } : {}) }
        }

        const command = manifest.command?.trim()
        const port = manifest.port
        if (!command || !port || !Number.isInteger(port) || port < 1 || port > 65535) return null
        const installCommand = manifest.installCommand?.trim()
        const entryPath = manifest.entryPath?.trim()
        const note = manifest.note?.trim()
        return {
            mode: 'service',
            command,
            port,
            ...(installCommand ? { installCommand } : {}),
            ...(entryPath ? { entryPath } : {}),
            ...(note ? { note } : {})
        }
    }

    /** 卡片要列出的产物：static 优先入口文件本身，否则全部可预览产物。 */
    private selectCardArtifacts(
        manifest: DeployManifest,
        artifacts: BlackboardArtifact[]
    ): BlackboardArtifact[] {
        if (manifest.mode === 'static' && manifest.entryPath) {
            const entry = artifacts.find((a) => a.path === manifest.entryPath)
            if (entry) return [entry]
        }
        return artifacts
    }

    private isHiddenArtifact(path: string): boolean {
        const hidden = new Set(['.codex', '.agents', '.claude'])
        return path.split(/[\\/]+/).some((segment) => hidden.has(segment))
    }

    private async persistReviewerSessionId(
        group: GroupChat,
        review: OrchestratorFinalReviewResult
    ): Promise<void> {
        await this.persistOrchestratorSessionId(group, review.orchestratorSessionId)
    }

    private async persistOrchestratorSessionId(
        group: GroupChat,
        orchestratorSessionId?: string | null
    ): Promise<void> {
        if (!orchestratorSessionId || group.orchestratorSessionId === orchestratorSessionId) return
        group.orchestratorSessionId = orchestratorSessionId
        await this.groupRepo.save(group)
    }

    private buildFallbackFollowUpInstruction(
        originalUserText: string,
        review: OrchestratorFinalReviewResult
    ): string {
        const gaps =
            review.gaps.length > 0
                ? review.gaps.map((gap) => `- ${gap}`).join('\n')
                : '- 产物未完全满足原始需求'
        return [
            '【最终验收未通过，需要继续派发任务】',
            `原始用户需求：${originalUserText}`,
            `验收说明：${review.summary}`,
            `缺口：\n${gaps}`,
            '请根据这些缺口继续创建成员 tasks，直到产物真正满足原始需求。'
        ].join('\n')
    }

    private buildFallbackReviewSubject(outcomes: TaskOutcome[]): string {
        if (outcomes.length === 0) return '请确认本轮群聊任务执行状态并向用户汇报。'
        return [
            '请确认本轮群聊任务执行状态并向用户汇报。',
            '本次调用未携带原始用户需求，请以成员任务结果、黑板摘要和产物预览作为判断依据。',
            outcomes.map((o) => `- [${o.status}] ${o.name}：${o.summary}`).join('\n')
        ].join('\n')
    }
}
