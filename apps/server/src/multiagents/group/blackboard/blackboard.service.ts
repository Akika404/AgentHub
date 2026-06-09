import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import type {
    BlackboardArtifact,
    BlackboardArtifactStatus,
    BlackboardArtifactType,
    BlackboardContract,
    BlackboardDecision,
    BlackboardDecisionStatus,
    BlackboardEventView,
    BlackboardTaskNode,
    BlackboardTaskStatus,
    BlackboardUpdateKind,
    BlackboardUpdateOp,
    BlackboardView
} from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'
import { BlackboardArtifactEntity } from './entities/blackboard-artifact.entity.js'
import { BlackboardContractEntity } from './entities/blackboard-contract.entity.js'
import { BlackboardDecisionEntity } from './entities/blackboard-decision.entity.js'
import { BlackboardEventEntity } from './entities/blackboard-event.entity.js'
import { BlackboardTaskEntity } from './entities/blackboard-task.entity.js'
import {
    toArtifactView,
    toBlackboardView,
    toContractView,
    toDecisionView,
    toEventView,
    toTaskView
} from '../mappers/blackboard.mapper.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'
import { decodeGitQuotedPath } from '../git-path.js'

export interface ArtifactUpsert {
    path: string
    type: BlackboardArtifactType
    summary: string
    ownerAgentId: string
    updatedByAgentId: string
    status?: BlackboardArtifactStatus
}

export interface DecisionWrite {
    content: string
    rationale?: string | null
    scope?: string | null
    supersedes?: string[]
    createdByAgentId: string
    status?: BlackboardDecisionStatus
    approvedBy?: string | null
}

export interface ContractWrite {
    contractKey: string
    spec: Record<string, unknown>
    ownerAgentId: string
    consumers?: string[]
    approvalRequired?: boolean
}

export interface TaskGraphInput {
    /** planner 本地 key（用于解析 deps），落库后映射为真实 id */
    key: string
    name: string
    agentId: string | null
    deps: string[]
    objective: string
    status?: BlackboardTaskStatus
}

export interface BlackboardEventInput {
    kind: BlackboardUpdateKind
    targetId: string
    op: BlackboardUpdateOp
    summary: string
    actorAgentId?: string | null
}

/**
 * BlackboardService — 黑板（群聊唯一结构化真相源）读写。
 *
 * 实现三大保护：
 * - 产出物乐观锁（based_on_version 不符 → CONFLICT，要求重读）；
 * - 决策 supersede（写新决策时把被取代的旧决策置 superseded）；
 * - 契约 owner 保护（非 owner 改 approvalRequired 契约 → FORBIDDEN，上报 Orchestrator）。
 *
 * 不调 LLM。每次状态变更都 append 一条 `blackboard_event`。
 */
@Injectable()
export class BlackboardService {
    constructor(
        @InjectRepository(BlackboardArtifactEntity)
        private readonly artifactRepo: Repository<BlackboardArtifactEntity>,
        @InjectRepository(BlackboardDecisionEntity)
        private readonly decisionRepo: Repository<BlackboardDecisionEntity>,
        @InjectRepository(BlackboardContractEntity)
        private readonly contractRepo: Repository<BlackboardContractEntity>,
        @InjectRepository(BlackboardTaskEntity)
        private readonly taskRepo: Repository<BlackboardTaskEntity>,
        @InjectRepository(BlackboardEventEntity)
        private readonly eventRepo: Repository<BlackboardEventEntity>,
        private readonly debug: GroupDebugLogger
    ) {}

    async getState(groupId: string): Promise<BlackboardView> {
        const [artifacts, decisions, contracts, tasks] = await Promise.all([
            this.artifactRepo.find({
                where: { groupChatId: groupId },
                order: { updatedAt: 'DESC' }
            }),
            this.decisionRepo.find({
                where: { groupChatId: groupId },
                order: { createdAt: 'ASC' }
            }),
            this.contractRepo.find({
                where: { groupChatId: groupId },
                order: { contractKey: 'ASC' }
            }),
            this.taskRepo.find({ where: { groupChatId: groupId }, order: { seq: 'ASC' } })
        ])
        const state = toBlackboardView(artifacts, decisions, contracts, tasks)
        this.debug.log('group.blackboard.read_state', {
            groupId,
            blackboard: this.debug.blackboardSnapshot(state)
        })
        return state
    }

    /** 本群处于 waiting_input（成员挂起等待用户答复）的任务，供恢复判定（需 runId/agentId，故返回实体）。 */
    async listWaitingTasks(groupId: string): Promise<BlackboardTaskEntity[]> {
        const tasks = await this.taskRepo.find({
            where: { groupChatId: groupId, status: 'waiting_input' },
            order: { seq: 'ASC' }
        })
        this.debug.log('group.blackboard.list_waiting_tasks', {
            groupId,
            taskIds: tasks.map((t) => t.id)
        })
        return tasks
    }

    /** 按原编排图的 runId 重载该图全部任务节点，供挂起恢复后继续调度下游。 */
    async listTasksByRunId(groupId: string, runId: string): Promise<BlackboardTaskNode[]> {
        const tasks = await this.taskRepo.find({
            where: { groupChatId: groupId, runId },
            order: { seq: 'ASC' }
        })
        return tasks.map(toTaskView)
    }

    async getArtifact(groupId: string, path: string): Promise<BlackboardArtifact | null> {
        const e = await this.findArtifactByPath(groupId, path)
        const artifact = e ? toArtifactView(e) : null
        this.debug.log('group.blackboard.read_artifact', { groupId, path, artifact })
        return artifact
    }

    async getArtifactById(groupId: string, artifactId: string): Promise<BlackboardArtifact | null> {
        const e = await this.artifactRepo.findOne({
            where: { groupChatId: groupId, id: artifactId }
        })
        const artifact = e ? toArtifactView(e) : null
        this.debug.log('group.blackboard.read_artifact_by_id', { groupId, artifactId, artifact })
        return artifact
    }

    /** 产出物 upsert（乐观锁）。version 不符 → CONFLICT，要求重读后重试。 */
    async upsertArtifact(
        groupId: string,
        patch: ArtifactUpsert,
        basedOnVersion?: number
    ): Promise<BlackboardArtifact> {
        const existing = await this.findArtifactByPath(groupId, patch.path)
        if (!existing) {
            const created = await this.artifactRepo.save(
                this.artifactRepo.create({
                    groupChatId: groupId,
                    type: patch.type,
                    path: patch.path,
                    ownerAgentId: patch.ownerAgentId,
                    version: 1,
                    status: patch.status ?? 'draft',
                    summary: patch.summary,
                    updatedByAgentId: patch.updatedByAgentId
                })
            )
            await this.appendEvent(groupId, {
                kind: 'artifact',
                targetId: created.id,
                op: 'created',
                summary: `新增产出物 ${patch.path}`,
                actorAgentId: patch.updatedByAgentId
            })
            const artifact = toArtifactView(created)
            this.debug.log('group.blackboard.write_artifact.created', {
                groupId,
                basedOnVersion,
                patch,
                artifact
            })
            return artifact
        }

        if (basedOnVersion !== undefined && basedOnVersion !== existing.version) {
            this.debug.log('group.blackboard.write_artifact.conflict', {
                groupId,
                path: patch.path,
                basedOnVersion,
                currentVersion: existing.version
            })
            throw BusinessException.conflict(
                `BLACKBOARD_CONFLICT: artifact ${patch.path} expected version ${existing.version}, got ${basedOnVersion}; re-read before writing`,
                {
                    reason: 'BLACKBOARD_CONFLICT',
                    path: patch.path,
                    currentVersion: existing.version
                }
            )
        }

        existing.version += 1
        existing.type = patch.type
        existing.path = patch.path
        existing.summary = patch.summary
        existing.status = patch.status ?? existing.status
        existing.updatedByAgentId = patch.updatedByAgentId
        const saved = await this.artifactRepo.save(existing)
        await this.appendEvent(groupId, {
            kind: 'artifact',
            targetId: saved.id,
            op: 'updated',
            summary: `更新产出物 ${patch.path} -> v${saved.version}`,
            actorAgentId: patch.updatedByAgentId
        })
        const artifact = toArtifactView(saved)
        this.debug.log('group.blackboard.write_artifact.updated', {
            groupId,
            basedOnVersion,
            patch,
            artifact
        })
        return artifact
    }

    private async findArtifactByPath(
        groupId: string,
        path: string
    ): Promise<BlackboardArtifactEntity | null> {
        const direct = await this.artifactRepo.findOne({ where: { groupChatId: groupId, path } })
        if (direct) return direct

        const artifacts = await this.artifactRepo.find({ where: { groupChatId: groupId } })
        return artifacts.find((artifact) => decodeGitQuotedPath(artifact.path) === path) ?? null
    }

    /** 写决策：把 supersedes 指向的旧决策置 superseded。 */
    async writeDecision(groupId: string, input: DecisionWrite): Promise<BlackboardDecision> {
        const saved = await this.decisionRepo.save(
            this.decisionRepo.create({
                groupChatId: groupId,
                content: input.content,
                rationale: input.rationale ?? null,
                status: input.status ?? 'proposed',
                scope: input.scope ?? null,
                supersedes: input.supersedes ?? null,
                createdByAgentId: input.createdByAgentId,
                approvedBy: input.approvedBy ?? null
            })
        )
        for (const oldId of input.supersedes ?? []) {
            const old = await this.decisionRepo.findOne({
                where: { id: oldId, groupChatId: groupId }
            })
            if (old && old.status !== 'superseded') {
                old.status = 'superseded'
                await this.decisionRepo.save(old)
                await this.appendEvent(groupId, {
                    kind: 'decision',
                    targetId: old.id,
                    op: 'superseded',
                    summary: `决策被取代：${old.content.slice(0, 60)}`,
                    actorAgentId: input.createdByAgentId
                })
            }
        }
        await this.appendEvent(groupId, {
            kind: 'decision',
            targetId: saved.id,
            op: 'created',
            summary: `新决策：${saved.content.slice(0, 60)}`,
            actorAgentId: input.createdByAgentId
        })
        const decision = toDecisionView(saved)
        this.debug.log('group.blackboard.write_decision', {
            groupId,
            input,
            decision
        })
        return decision
    }

    async getContract(groupId: string, contractKey: string): Promise<BlackboardContract | null> {
        const e = await this.contractRepo.findOne({ where: { groupChatId: groupId, contractKey } })
        const contract = e ? toContractView(e) : null
        this.debug.log('group.blackboard.read_contract', { groupId, contractKey, contract })
        return contract
    }

    /**
     * 写契约。非 owner 触碰 approvalRequired 契约 → FORBIDDEN（上报 Orchestrator）。
     * 仅 owner 可改；新契约任何成员可建。
     */
    async writeContract(
        groupId: string,
        input: ContractWrite,
        actorAgentId: string
    ): Promise<BlackboardContract> {
        const existing = await this.contractRepo.findOne({
            where: { groupChatId: groupId, contractKey: input.contractKey }
        })
        if (existing) {
            if (existing.ownerAgentId !== actorAgentId && existing.approvalRequired) {
                this.debug.log('group.blackboard.write_contract.rejected', {
                    groupId,
                    input,
                    actorAgentId,
                    ownerAgentId: existing.ownerAgentId,
                    approvalRequired: existing.approvalRequired
                })
                throw BusinessException.forbidden(
                    `CONTRACT_APPROVAL_REQUIRED: contract ${input.contractKey} is owned by ${existing.ownerAgentId} and requires approval`,
                    {
                        reason: 'CONTRACT_APPROVAL_REQUIRED',
                        contractKey: input.contractKey,
                        ownerAgentId: existing.ownerAgentId
                    }
                )
            }
            existing.spec = input.spec
            if (input.consumers !== undefined) existing.consumers = input.consumers
            if (input.approvalRequired !== undefined) {
                existing.approvalRequired = input.approvalRequired
            }
            existing.version += 1
            const saved = await this.contractRepo.save(existing)
            await this.appendEvent(groupId, {
                kind: 'contract',
                targetId: saved.contractKey,
                op: 'updated',
                summary: `更新契约 ${saved.contractKey} -> v${saved.version}`,
                actorAgentId
            })
            const contract = toContractView(saved)
            this.debug.log('group.blackboard.write_contract.updated', {
                groupId,
                input,
                actorAgentId,
                contract
            })
            return contract
        }
        const created = await this.contractRepo.save(
            this.contractRepo.create({
                groupChatId: groupId,
                contractKey: input.contractKey,
                spec: input.spec,
                ownerAgentId: input.ownerAgentId,
                consumers: input.consumers ?? null,
                approvalRequired: input.approvalRequired ?? false,
                version: 1
            })
        )
        await this.appendEvent(groupId, {
            kind: 'contract',
            targetId: created.contractKey,
            op: 'created',
            summary: `新增契约 ${created.contractKey}`,
            actorAgentId
        })
        const contract = toContractView(created)
        this.debug.log('group.blackboard.write_contract.created', {
            groupId,
            input,
            actorAgentId,
            contract
        })
        return contract
    }

    /**
     * 判断某 Agent 能否写某契约（不抛异常版本，供 dispatch 校验 report.affected.contracts）。
     * 契约不存在 → 可写（新建）；存在且（owner 本人 或 非 approvalRequired）→ 可写。
     */
    async canWriteContract(
        groupId: string,
        contractKey: string,
        actorAgentId: string
    ): Promise<{ allowed: boolean; ownerAgentId: string | null }> {
        const existing = await this.contractRepo.findOne({
            where: { groupChatId: groupId, contractKey }
        })
        if (!existing) return { allowed: true, ownerAgentId: null }
        const allowed = existing.ownerAgentId === actorAgentId || !existing.approvalRequired
        this.debug.log('group.blackboard.can_write_contract', {
            groupId,
            contractKey,
            actorAgentId,
            allowed,
            ownerAgentId: existing.ownerAgentId,
            approvalRequired: existing.approvalRequired
        })
        return { allowed, ownerAgentId: existing.ownerAgentId }
    }

    /** 写入 task_graph（串行编排产出）。解析 planner 本地 key 的 deps 为真实 id。 */
    async upsertTaskGraph(
        groupId: string,
        runId: string,
        tasks: TaskGraphInput[]
    ): Promise<BlackboardTaskNode[]> {
        const keyToId = new Map<string, string>()
        for (const t of tasks) keyToId.set(t.key, randomUUID())
        const rows = tasks.map((t, i) =>
            this.taskRepo.create({
                id: keyToId.get(t.key),
                groupChatId: groupId,
                runId,
                name: t.name,
                agentId: t.agentId,
                deps: t.deps.map((k) => keyToId.get(k) ?? k),
                status: t.status ?? 'pending',
                objective: t.objective,
                seq: i
            })
        )
        const saved = await this.taskRepo.save(rows)
        for (const r of saved) {
            await this.appendEvent(groupId, {
                kind: 'task',
                targetId: r.id,
                op: 'created',
                summary: `规划任务 ${r.name}`,
                actorAgentId: null
            })
        }
        const nodes = saved.map(toTaskView)
        this.debug.log('group.blackboard.write_task_graph', {
            groupId,
            runId,
            inputTasks: tasks,
            nodes
        })
        return nodes
    }

    async setTaskStatus(
        groupId: string,
        taskId: string,
        status: BlackboardTaskStatus
    ): Promise<BlackboardTaskNode> {
        const task = await this.taskRepo.findOne({ where: { id: taskId, groupChatId: groupId } })
        if (!task) throw BusinessException.notFound(`Task ${taskId} not found`)
        task.status = status
        const saved = await this.taskRepo.save(task)
        await this.appendEvent(groupId, {
            kind: 'task',
            targetId: saved.id,
            op: 'updated',
            summary: `任务 ${saved.name} -> ${status}`,
            actorAgentId: null
        })
        const node = toTaskView(saved)
        this.debug.log('group.blackboard.set_task_status', {
            groupId,
            taskId,
            status,
            node
        })
        return node
    }

    async appendEvent(groupId: string, input: BlackboardEventInput): Promise<BlackboardEventView> {
        const saved = await this.eventRepo.save(
            this.eventRepo.create({
                groupChatId: groupId,
                kind: input.kind,
                targetId: input.targetId,
                op: input.op,
                summary: input.summary,
                actorAgentId: input.actorAgentId ?? null
            })
        )
        const event = toEventView(saved)
        this.debug.log('group.blackboard.append_event', { groupId, input, event })
        return event
    }

    async listEvents(groupId: string, limit = 100, offset = 0): Promise<BlackboardEventView[]> {
        const events = await this.eventRepo.find({
            where: { groupChatId: groupId },
            order: { createdAt: 'DESC' },
            take: Math.min(Math.max(limit, 1), 500),
            skip: Math.max(offset, 0)
        })
        const result = events.map(toEventView)
        this.debug.log('group.blackboard.list_events', {
            groupId,
            limit,
            offset,
            returned: result.length
        })
        return result
    }

    /** 产出 blackboardSummary（给 Orchestrator 上下文 + ContextAssembler 摘要）。 */
    async summarize(groupId: string): Promise<string> {
        const state = await this.getState(groupId)
        const lines: string[] = []
        if (state.artifacts.length) {
            lines.push('## Artifacts')
            for (const a of state.artifacts) {
                lines.push(
                    `- [${a.status}] ${a.path} (v${a.version}, owner=${a.ownerAgentId}): ${a.summary}`
                )
            }
        }
        if (state.contracts.length) {
            lines.push('## Contracts')
            for (const c of state.contracts) {
                lines.push(
                    `- ${c.id} (owner=${c.ownerAgentId}, approvalRequired=${c.approvalRequired}, v${c.version})`
                )
            }
        }
        if (state.decisions.length) {
            lines.push('## Decisions')
            for (const d of state.decisions.filter((x) => x.status !== 'superseded')) {
                lines.push(`- [${d.status}] ${d.content}`)
            }
        }
        if (state.taskGraph.length) {
            lines.push('## Tasks')
            for (const t of state.taskGraph) {
                lines.push(`- [${t.status}] ${t.name} (agent=${t.agentId ?? 'unassigned'})`)
            }
        }
        const summary = lines.join('\n') || '(blackboard empty)'
        this.debug.log('group.blackboard.summarize', { groupId, summary })
        return summary
    }
}
