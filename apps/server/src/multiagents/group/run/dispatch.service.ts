import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AgentMemoryType, BlackboardArtifactType, BlackboardUpdate } from '@agenthub/shared'
import { createAgent, type AgentEvent } from '../../adapter/index.js'
import { Agent } from '../../entities/agent.entity.js'
import { AgentSession } from '../../entities/agent-session.entity.js'
import { agentToConfig } from '../../mappers/agent.mapper.js'
import {
    AgentMessageHistoryService,
    type StepDraft
} from '../../messages/agent-message-history.service.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { BusinessException } from '../../../common/index.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { AgentMemoryService } from '../memory/agent-memory.service.js'
import { ContextAssembler, type TaskContext } from '../context/context-assembler.service.js'
import {
    ContinuityResolver,
    type ContinuityResult
} from '../routing/continuity-resolver.service.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

/** 成员收尾结构化报告（成员不直接写库，服务端据此 + git diff 代写黑板） */
interface MemberReport {
    summary: string
    affected?: { artifacts?: string[]; contracts?: string[]; decisions?: string[] }
    decisions?: Array<{
        content: string
        rationale?: string
        scope?: string
        supersedes?: string[]
    }>
    contracts?: Array<{
        contractKey: string
        spec: Record<string, unknown>
        approvalRequired?: boolean
        consumers?: string[]
    }>
    memory_candidate?: { content: string; type?: AgentMemoryType; module?: string | null }
}

export interface DispatchParams {
    group: GroupChat
    userId: string
    runId: string
    /** 已落库的任务节点 id */
    taskId: string
    taskName: string
    objective: string
    agent: Agent
    member: GroupChatMember
    continuity: ContinuityResult
    signal: AbortSignal
}

/** 派发收尾时需要 Orchestrator/用户裁决的冲突（受保护契约 / 工作区合并 / 产出物版本）。 */
export interface DispatchEscalation {
    kind: 'contract' | 'merge'
    detail: string
}

export interface DispatchResult {
    success: boolean
    summary: string
    /** 存在时表示遇冲突需停下问用户；executor 据此把任务计 failed 并阻塞下游。 */
    escalation?: DispatchEscalation
}

const REPORT_INSTRUCTION = `

# 收尾报告（必须）
完成实际工作后（用你的文件工具 read→plan→patch→test），在输出最后给出一个 JSON 报告，放在 \`\`\`report 代码块里：
\`\`\`report
{"summary":"一句话说明做了什么","affected":{"artifacts":[],"contracts":[],"decisions":[]},"decisions":[],"contracts":[],"memory_candidate":null}
\`\`\`
只有确有内容才填 decisions / contracts / memory_candidate。不要修改他人 owner 的 approvalRequired 契约。`

const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1000

/**
 * DispatchService — 单次派发（成员干活）。复用单聊适配层与消息历史：
 * ContextAssembler 装配 → 建 worktree → 取/重建成员 AgentSession(cwd=worktree) →
 * 跑 turn（事件入 group run Stream + 落 agent_message_step）→ 收口：git diff 代写黑板
 * 产出物（version+1）→ 合并 worktree → 处理成员报告（契约 owner 校验 / decisions
 * supersede / memory 去重）→ 追加 blackboard_event → 写 short_term_buffer。
 */
@Injectable()
export class DispatchService {
    private readonly logger = new Logger(DispatchService.name)

    constructor(
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        @InjectRepository(GroupChatMember)
        private readonly memberRepo: Repository<GroupChatMember>,
        private readonly assembler: ContextAssembler,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly providers: PlatformProviderService,
        private readonly blackboard: BlackboardService,
        private readonly memory: AgentMemoryService,
        private readonly messages: AgentMessageHistoryService,
        private readonly groupMessages: GroupMessageService,
        private readonly continuity: ContinuityResolver,
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger
    ) {}

    async dispatch(params: DispatchParams): Promise<DispatchResult> {
        const { group, userId, runId, taskId, agent, member } = params

        // 1. 装配上下文
        const mode = params.continuity.case === 'C' ? 'new_task' : 'modify_existing'
        const taskContext: TaskContext = {
            objective: params.objective,
            mode,
            constraints: [
                '仅 owner 可改共享契约；非 owner 触碰 approvalRequired 契约将被拒绝并上报'
            ],
            outputSpec: '交付改动 + 简短说明，并按要求输出 report'
        }
        const assembled = await this.assembler.assemble({
            groupId: group.id,
            agentId: agent.id,
            task: taskContext,
            scope: { project: group.id, module: member.roleInGroup },
            targetArtifacts: params.continuity.targetArtifactPaths,
            hotContext: params.continuity.hotContext
        })
        this.debug.log('group.dispatch.context_ready', {
            groupId: group.id,
            runId,
            taskId,
            taskName: params.taskName,
            agentId: agent.id,
            agentName: agent.name,
            objective: params.objective,
            continuity: params.continuity,
            assemblerTrace: assembled.trace,
            blackboard: assembled.debug.blackboard,
            memory: {
                raw: assembled.debug.rawMemory,
                kept: assembled.debug.keptMemory,
                dropped: assembled.debug.droppedMemory
            },
            promptChars: assembled.debug.promptChars
        })

        // #5 乐观锁基线：派发前快照各产出物版本，writeback 时带 based_on_version，
        // 以检测并行任务对同一产出物的 clobber（版本不符 → 冲突上报，不静默覆盖）。
        const versionsBefore = new Map<string, number>()
        const stateBefore = await this.blackboard.getState(group.id)
        for (const a of stateBefore.artifacts) versionsBefore.set(a.path, a.version)

        // 2. worktree + 成员会话
        const worktree = await this.workspace.createTaskWorktree(
            group.id,
            taskId,
            group.workspaceDir
        )
        const session = await this.prepareMemberSession(group, member, agent, worktree)

        // 3. 跑成员 turn（复用适配层 + 消息历史）
        const prompt = `${assembled.prompt}${REPORT_INSTRUCTION}`
        this.debug.log('group.dispatch.agent_instruction', {
            groupId: group.id,
            runId,
            taskId,
            taskName: params.taskName,
            agent: {
                agentId: agent.id,
                name: agent.name,
                vendor: agent.vendor,
                model: agent.model,
                roleInGroup: member.roleInGroup
            },
            session: {
                id: session.id,
                workingDirectory: session.workingDirectory,
                sessionHomeDirectory: session.sessionHomeDirectory,
                sdkSessionId: session.sdkSessionId
            },
            worktree,
            prompt
        })
        let finalText = ''
        let fatal: string | null = null
        try {
            const result = await this.runMemberTurn(params, session, agent, prompt)
            finalText = result.finalText
            fatal = result.fatal
        } catch (err) {
            fatal = this.errMsg(err)
        }

        const report = this.parseReport(finalText)
        const summary = report.summary || finalText.slice(0, 200) || '(无输出)'
        this.debug.log('group.dispatch.agent_output', {
            groupId: group.id,
            runId,
            taskId,
            agentId: agent.id,
            fatal,
            finalText,
            report,
            summary
        })

        // 4. 收口：git → 黑板；成功才提交/合并，失败仅清理 worktree
        const updates: BlackboardUpdate[] = []
        const escalations: DispatchEscalation[] = []
        if (!fatal) {
            try {
                const changed = await this.workspace.diffArtifacts(group.id, taskId)
                this.debug.log('group.dispatch.git_diff', {
                    groupId: group.id,
                    runId,
                    taskId,
                    agentId: agent.id,
                    changed
                })
                for (const file of changed) {
                    if (file.status === 'D') continue
                    try {
                        const artifact = await this.blackboard.upsertArtifact(
                            group.id,
                            {
                                path: file.path,
                                type: this.artifactType(file.path),
                                summary: summary,
                                ownerAgentId: agent.id,
                                updatedByAgentId: agent.id,
                                status: 'draft'
                            },
                            versionsBefore.get(file.path)
                        )
                        updates.push({
                            kind: 'artifact',
                            targetId: artifact.id,
                            op: artifact.version === 1 ? 'created' : 'updated',
                            summary: `${file.path} -> v${artifact.version}`
                        })
                    } catch (err) {
                        if (this.isBlackboardConflict(err)) {
                            const detail = `产出物 ${file.path} 版本冲突（已被其它任务更新），需重读后重写`
                            escalations.push({ kind: 'merge', detail })
                            await this.blackboard
                                .appendEvent(group.id, {
                                    kind: 'artifact',
                                    targetId: file.path,
                                    op: 'rejected',
                                    summary: detail,
                                    actorAgentId: agent.id
                                })
                                .catch(() => undefined)
                            this.logger.warn(`Artifact version conflict on ${file.path}`)
                        } else {
                            this.logger.error(
                                `Artifact writeback failed for ${file.path}: ${this.errMsg(err)}`
                            )
                        }
                    }
                }
            } catch (err) {
                this.logger.error(`Artifact writeback failed: ${this.errMsg(err)}`)
            }
        }
        try {
            await this.workspace.mergeTaskWorktree(group.id, taskId, group.workspaceDir)
        } catch (err) {
            const detail = `任务「${params.taskName}」工作区合并冲突：${this.errMsg(err)}`
            this.logger.error(`Merge/cleanup failed for task ${taskId}: ${this.errMsg(err)}`)
            escalations.push({ kind: 'merge', detail })
            await this.blackboard
                .appendEvent(group.id, {
                    kind: 'task',
                    targetId: taskId,
                    op: 'rejected',
                    summary: detail,
                    actorAgentId: agent.id
                })
                .catch(() => undefined)
        }

        // 5. 处理成员报告（仅成功时）
        if (!fatal) {
            await this.applyReport(params, report, updates, escalations)
        }

        for (const update of updates) {
            await this.runStream.publish(runId, { type: 'blackboard_update', runId, update })
        }
        this.debug.log('group.dispatch.blackboard_updates', {
            groupId: group.id,
            runId,
            taskId,
            agentId: agent.id,
            updates
        })

        // 6. 展示层成员发言 + 写热缓冲
        await this.groupMessages.appendText(group.id, userId, 'agent', summary, agent.id)
        await this.writeHotBuffer(params, summary, updates)

        const escalation = this.foldEscalations(escalations)
        const result: DispatchResult = {
            success: !fatal && !escalation,
            summary: fatal
                ? `失败：${fatal}`
                : escalation
                  ? `需决策：${escalation.detail}`
                  : summary,
            ...(escalation ? { escalation } : {})
        }
        this.debug.log('group.dispatch.finished', {
            groupId: group.id,
            runId,
            taskId,
            agentId: agent.id,
            result
        })
        return result
    }

    private async runMemberTurn(
        params: DispatchParams,
        session: AgentSession,
        agent: Agent,
        prompt: string
    ): Promise<{ finalText: string; fatal: string | null }> {
        const provider = await this.resolveProvider(params.userId, agent)
        const config = agentToConfig(agent, session, provider.apiKey, provider.baseUrl, session.id)
        const adapter = createAgent(agent.vendor, config)
        // 情况 A 续接热会话；B/C 全重开（不 resume）
        if (params.continuity.case === 'A' && session.sdkSessionId) {
            adapter.resumeWith(session.sdkSessionId)
        }
        this.debug.log('group.dispatch.turn_started', {
            groupId: params.group.id,
            runId: params.runId,
            taskId: params.taskId,
            agentId: agent.id,
            vendor: agent.vendor,
            model: agent.model,
            continuityCase: params.continuity.case,
            resumedSdkSessionId: params.continuity.case === 'A' ? session.sdkSessionId : null,
            workingDirectory: session.workingDirectory,
            prompt
        })

        const stepDrafts: StepDraft[] = []
        const toolIndex = new Map<string, number>()
        const textParts: string[] = []
        let finalFromDone: string | null = null
        let fatal: string | null = null

        let timeout: NodeJS.Timeout | null = null
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(
                () => reject(new Error('member turn timed out')),
                DEFAULT_TURN_TIMEOUT_MS
            )
            timeout.unref?.()
        })

        await this.messages.saveMessage(
            params.userId,
            agent.id,
            session.id,
            'user',
            params.objective
        )
        try {
            const iterator = adapter.send(prompt, { signal: params.signal })[Symbol.asyncIterator]()
            while (true) {
                const next = await Promise.race([iterator.next(), timeoutPromise])
                if (next.done) break
                const ev = next.value
                if (ev.type === 'done') {
                    if (ev.finalText) finalFromDone = ev.finalText
                    continue
                }
                if (ev.type === 'text') textParts.push(ev.text)
                else if (ev.type === 'error' && ev.fatal) fatal = ev.message
                else this.messages.collectStep(ev, stepDrafts, toolIndex)
                this.debug.log('group.dispatch.turn_event', {
                    groupId: params.group.id,
                    runId: params.runId,
                    taskId: params.taskId,
                    agentId: agent.id,
                    event: ev
                })
                await this.publishMemberEvent(params, ev)
            }
        } catch (err) {
            fatal ??= this.errMsg(err)
        } finally {
            if (timeout) clearTimeout(timeout)
        }

        const finalText = (finalFromDone ?? textParts.join('')).trim()
        this.debug.log('group.dispatch.turn_finished', {
            groupId: params.group.id,
            runId: params.runId,
            taskId: params.taskId,
            agentId: agent.id,
            fatal,
            finalText,
            stepCount: stepDrafts.length
        })

        // 落成员私有 L1（agent_message + agent_message_step）+ 持久化 sdk 句柄
        try {
            if (finalText) {
                const msg = await this.messages.saveMessage(
                    params.userId,
                    agent.id,
                    session.id,
                    'agent',
                    finalText
                )
                if (msg) await this.messages.saveSteps(msg.id, session.id, stepDrafts)
            }
            session.sdkSessionId = adapter.sessionId ?? session.sdkSessionId
            session.status = 'active'
            session.lastTurnAt = new Date()
            await this.sessionRepo.save(session)
        } catch (err) {
            this.logger.error(`Failed to persist member turn: ${this.errMsg(err)}`)
        }

        return { finalText, fatal }
    }

    private async publishMemberEvent(params: DispatchParams, ev: AgentEvent): Promise<void> {
        await this.runStream
            .publish(params.runId, {
                type: 'member_turn_event',
                runId: params.runId,
                taskId: params.taskId,
                agentId: params.agent.id,
                event: ev
            })
            .catch(() => undefined)
    }

    /** 处理成员报告：契约 owner 校验 / decisions supersede / memory 去重写入。 */
    private async applyReport(
        params: DispatchParams,
        report: MemberReport,
        updates: BlackboardUpdate[],
        escalations: DispatchEscalation[]
    ): Promise<void> {
        const { group, userId, agent } = params
        this.debug.log('group.dispatch.apply_report', {
            groupId: group.id,
            runId: params.runId,
            taskId: params.taskId,
            agentId: agent.id,
            report
        })

        for (const contract of report.contracts ?? []) {
            if (!contract.contractKey) continue
            const check = await this.blackboard.canWriteContract(
                group.id,
                contract.contractKey,
                agent.id
            )
            if (!check.allowed) {
                const detail = `成员 ${agent.name} 试图修改受保护契约 ${contract.contractKey}（owner=${check.ownerAgentId}），已拒绝`
                escalations.push({ kind: 'contract', detail })
                await this.groupMessages.appendSystem(
                    group.id,
                    userId,
                    `${detail}并上报 Orchestrator。`
                )
                await this.blackboard.appendEvent(group.id, {
                    kind: 'contract',
                    targetId: contract.contractKey,
                    op: 'rejected',
                    summary: `拒绝非 owner 修改契约 ${contract.contractKey}`,
                    actorAgentId: agent.id
                })
                updates.push({
                    kind: 'contract',
                    targetId: contract.contractKey,
                    op: 'rejected',
                    summary: `拒绝修改受保护契约 ${contract.contractKey}`
                })
                continue
            }
            try {
                const saved = await this.blackboard.writeContract(
                    group.id,
                    {
                        contractKey: contract.contractKey,
                        spec: contract.spec ?? {},
                        ownerAgentId: agent.id,
                        consumers: contract.consumers,
                        approvalRequired: contract.approvalRequired
                    },
                    agent.id
                )
                updates.push({
                    kind: 'contract',
                    targetId: saved.id,
                    op: 'updated',
                    summary: `契约 ${saved.id} v${saved.version}`
                })
            } catch (err) {
                this.logger.warn(`writeContract failed: ${this.errMsg(err)}`)
            }
        }

        for (const decision of report.decisions ?? []) {
            if (!decision.content) continue
            const saved = await this.blackboard.writeDecision(group.id, {
                content: decision.content,
                rationale: decision.rationale ?? null,
                scope: decision.scope ?? null,
                supersedes: decision.supersedes,
                createdByAgentId: agent.id,
                status: 'proposed'
            })
            updates.push({
                kind: 'decision',
                targetId: saved.id,
                op: 'created',
                summary: `决策：${saved.content.slice(0, 40)}`
            })
        }

        const candidate = report.memory_candidate
        if (candidate?.content) {
            const memory = await this.memory.writeCandidate(agent.id, userId, {
                content: candidate.content,
                type: candidate.type ?? 'lesson',
                scope: { project: group.id, module: candidate.module ?? params.member.roleInGroup },
                source: { type: 'self_summary', ref: params.taskId }
            })
            this.debug.log('group.dispatch.memory_candidate', {
                groupId: group.id,
                runId: params.runId,
                taskId: params.taskId,
                agentId: agent.id,
                candidate,
                savedMemory: memory
            })
        }
    }

    private async writeHotBuffer(
        params: DispatchParams,
        summary: string,
        updates: BlackboardUpdate[]
    ): Promise<void> {
        const artifactPaths = params.continuity.targetArtifactPaths
        const recentArtifacts = await Promise.all(
            artifactPaths.map(async (path) => {
                const a = await this.blackboard.getArtifact(params.group.id, path)
                return a ? { path: a.path, version: a.version } : null
            })
        )
        await this.continuity.writeBuffer(params.group.id, params.agent.id, {
            recentUserIntents: [params.objective],
            recentAgentOutputs: [summary],
            recentArtifacts: recentArtifacts.filter(
                (a): a is { path: string; version: number } => a !== null
            ),
            mentionIndex: {}
        })
        this.debug.log('group.dispatch.hot_buffer_written', {
            groupId: params.group.id,
            runId: params.runId,
            taskId: params.taskId,
            agentId: params.agent.id,
            summary,
            updates,
            recentArtifacts
        })
    }

    private async prepareMemberSession(
        group: GroupChat,
        member: GroupChatMember,
        agent: Agent,
        worktree: string
    ): Promise<AgentSession> {
        const home = resolve(this.workspace.memberHomeDir(group.id, agent.id))
        let session: AgentSession | null = null
        if (member.agentSessionId) {
            session = await this.sessionRepo.findOne({ where: { id: member.agentSessionId } })
        }
        if (!session) {
            session = this.sessionRepo.create({
                id: randomUUID(),
                userId: group.userId,
                agentId: agent.id,
                vendor: agent.vendor,
                title: null,
                workingDirectory: worktree,
                sessionHomeDirectory: home,
                skills: agent.skills,
                mcpServers: agent.mcpServers,
                sdkSessionId: null,
                status: 'active',
                lastTurnAt: null
            })
            session = await this.sessionRepo.save(session)
            member.agentSessionId = session.id
            await this.memberRepo.save(member)
            this.debug.log('group.dispatch.session_created', {
                groupId: group.id,
                agentId: agent.id,
                sessionId: session.id,
                worktree,
                home
            })
        }
        session.workingDirectory = worktree
        await this.sessionRepo.save(session)

        await this.agentWorkspace.ensureAgentHomeDirectory(agent.vendor, agent.agentHomeDirectory)
        await this.agentWorkspace.ensureChatRuntimeDirectories(agent.vendor, worktree, home)
        await this.agentWorkspace.syncVendorConfigToWorkingDirectory(
            agent.vendor,
            agent.agentHomeDirectory,
            worktree
        )
        this.debug.log('group.dispatch.session_prepared', {
            groupId: group.id,
            agentId: agent.id,
            sessionId: session.id,
            worktree,
            home,
            sdkSessionId: session.sdkSessionId
        })
        return session
    }

    private async resolveProvider(
        userId: string,
        agent: Agent
    ): Promise<{ apiKey: string; baseUrl: string }> {
        try {
            const provider = await this.providers.resolveRuntimeConfig(
                userId,
                agent.platformProviderId
            )
            return { apiKey: provider.apiKey, baseUrl: provider.baseUrl }
        } catch {
            throw BusinessException.agentUnavailable(
                `Member ${agent.id} provider ${agent.platformProviderId} unavailable`
            )
        }
    }

    private parseReport(text: string): MemberReport {
        const block = text.match(/```report\s*([\s\S]*?)```/)
        const raw = block ? block[1] : null
        if (raw) {
            try {
                const obj = JSON.parse(raw.trim()) as MemberReport
                if (obj && typeof obj.summary === 'string') return obj
            } catch {
                // fall through
            }
        }
        return {
            summary: text
                .replace(/```report[\s\S]*?```/g, '')
                .trim()
                .slice(0, 200)
        }
    }

    private artifactType(path: string): BlackboardArtifactType {
        const lower = path.toLowerCase()
        if (/\.(md|txt|rst|adoc)$/.test(lower)) return 'document'
        if (/test|spec/.test(lower)) return 'test_report'
        if (/\.(png|svg|fig|sketch)$/.test(lower)) return 'design'
        return 'code'
    }

    private isBlackboardConflict(err: unknown): boolean {
        return this.errMsg(err).includes('BLACKBOARD_CONFLICT')
    }

    /** 多个冲突合并为一条上报：有合并/版本冲突优先按 merge，否则 contract；明细拼接。 */
    private foldEscalations(escalations: DispatchEscalation[]): DispatchEscalation | undefined {
        if (escalations.length === 0) return undefined
        const kind: DispatchEscalation['kind'] = escalations.some((e) => e.kind === 'merge')
            ? 'merge'
            : 'contract'
        return { kind, detail: escalations.map((e) => e.detail).join('；') }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
