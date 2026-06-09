import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { DataSource, In, Repository } from 'typeorm'
import type {
    CreateGroupChatPayload,
    GroupChatView,
    UpdateGroupChatPayload
} from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import { AgentMessage } from '../entities/agent-message.entity.js'
import { AgentMessageStep } from '../entities/agent-message-step.entity.js'
import { AgentPolicyService } from '../agents/agent-policy.service.js'
import { PlatformProviderService } from '../../platform-provider/platform-provider.service.js'
import { GroupChat } from './entities/group-chat.entity.js'
import { GroupChatMember } from './entities/group-chat-member.entity.js'
import { GroupMessage } from './entities/group-message.entity.js'
import { GroupRun } from './entities/group-run.entity.js'
import { BlackboardArtifactEntity } from './blackboard/entities/blackboard-artifact.entity.js'
import { BlackboardDecisionEntity } from './blackboard/entities/blackboard-decision.entity.js'
import { BlackboardContractEntity } from './blackboard/entities/blackboard-contract.entity.js'
import { BlackboardTaskEntity } from './blackboard/entities/blackboard-task.entity.js'
import { BlackboardEventEntity } from './blackboard/entities/blackboard-event.entity.js'
import { AgentMemoryItemEntity } from './memory/entities/agent-memory-item.entity.js'
import { GroupWorkspaceService } from './group-workspace.service.js'
import { WorkspaceDiffService } from '../workspace/workspace-diff.service.js'
import { GroupRunStream } from './run/group-run-stream.service.js'
import { toGroupChatView } from './mappers/group-chat.mapper.js'
import { UserWorkspaceService } from '../../user-workspace/user-workspace.service.js'

/**
 * GroupChatService — 群聊的创建/管理与共享工作区编排。
 *
 * 数据隔离沿用单聊范式：所有方法以 userId 限定，非本人记录按 NOT_FOUND 处理。
 * 也对外暴露若干装载助手（loadGroup/listMembersWithAgents/resolveMemberSession 等）
 * 供编排链路（dispatch / orchestrator）复用。
 */
@Injectable()
export class GroupChatService {
    constructor(
        @InjectRepository(GroupChat)
        private readonly groupRepo: Repository<GroupChat>,
        @InjectRepository(GroupChatMember)
        private readonly memberRepo: Repository<GroupChatMember>,
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        private readonly workspace: GroupWorkspaceService,
        private readonly workspaceDiff: WorkspaceDiffService,
        private readonly userWorkspace: UserWorkspaceService,
        private readonly policy: AgentPolicyService,
        private readonly providers: PlatformProviderService,
        private readonly runStream: GroupRunStream,
        private readonly dataSource: DataSource
    ) {}

    async createGroupChat(userId: string, payload: CreateGroupChatPayload): Promise<GroupChatView> {
        const title = payload.title?.trim()
        if (!title) throw BusinessException.badRequest('Group title cannot be empty')

        const memberAgentIds = [...new Set(payload.memberAgentIds ?? [])]
        if (memberAgentIds.length === 0) {
            throw BusinessException.badRequest('A group chat needs at least one member Agent')
        }
        const agents = await this.agentRepo.find({
            where: { userId, id: In(memberAgentIds) }
        })
        if (agents.length !== memberAgentIds.length) {
            throw BusinessException.badRequest('Some member Agents do not exist or are not yours')
        }

        await this.assertOrchestratorValid(userId, payload.orchestrator)

        const projectMeta = payload.projectMeta
        const projectName = projectMeta?.name?.trim()
        if (!projectName) throw BusinessException.badRequest('projectMeta.name cannot be empty')

        const group = this.groupRepo.create({
            userId,
            title,
            status: 'active',
            isPinned: false,
            archivedAt: null,
            workspaceDir: '',
            orchestratorVendor: payload.orchestrator.vendor,
            orchestratorModel: payload.orchestrator.model,
            orchestratorProviderId: payload.orchestrator.providerId,
            projectName,
            projectGoal: projectMeta.goal?.trim() ? projectMeta.goal.trim() : null,
            projectTechStack: projectMeta.techStack ?? [],
            projectStatus: projectMeta.status ?? 'planning'
        })
        const saved = await this.groupRepo.save(group)

        // 创建共享 git 工作区（优先用户指定目录；未指定则后端分配）；失败则回滚群记录
        try {
            const requestedWorkspaceDir = payload.workspaceDir?.trim()
                ? await this.userWorkspace.assertPathInRoot(
                      userId,
                      'agent_workspace',
                      payload.workspaceDir,
                      'Group workspaceDir'
                  )
                : await this.userWorkspace.allocateGroupWorkspaceDirectory(userId, saved.id)
            saved.workspaceDir = await this.workspace.createWorkspace(
                saved.id,
                requestedWorkspaceDir
            )
            await this.workspaceDiff.markCheckpoint(saved.workspaceDir, 'group-chat', saved.id)
            await this.groupRepo.save(saved)
        } catch (err) {
            await this.groupRepo.delete({ id: saved.id, userId })
            throw err
        }

        const members = agents.map((agent) =>
            this.memberRepo.create({
                userId,
                groupChatId: saved.id,
                agentId: agent.id,
                roleInGroup: null,
                agentSessionId: null
            })
        )
        await this.memberRepo.save(members)

        return toGroupChatView(
            saved,
            members.map((member) => ({
                member,
                agent: agents.find((a) => a.id === member.agentId)!
            })),
            null
        )
    }

    async listGroupChats(userId: string): Promise<GroupChatView[]> {
        const groups = await this.groupRepo.find({
            where: { userId },
            order: { isPinned: 'DESC', updatedAt: 'DESC', createdAt: 'DESC' }
        })
        if (groups.length === 0) return []
        const activeRuns = await this.runStream.getActiveRuns(groups.map((g) => g.id))
        const views: GroupChatView[] = []
        for (const group of groups) {
            const members = await this.listMembersWithAgents(group.id)
            views.push(toGroupChatView(group, members, activeRuns.get(group.id) ?? null))
        }
        return views
    }

    async getGroupChat(userId: string, id: string): Promise<GroupChatView> {
        const group = await this.loadGroup(userId, id)
        const members = await this.listMembersWithAgents(group.id)
        const activeRunId = await this.runStream.getActiveRun(group.id)
        return toGroupChatView(group, members, activeRunId)
    }

    async updateGroupChat(
        userId: string,
        id: string,
        payload: UpdateGroupChatPayload
    ): Promise<GroupChatView> {
        const group = await this.loadGroup(userId, id)

        if (payload.title !== undefined) {
            const title = payload.title.trim()
            if (!title) throw BusinessException.badRequest('Group title cannot be empty')
            group.title = title
        }
        if (payload.projectMeta) {
            const pm = payload.projectMeta
            if (pm.name !== undefined) {
                const name = pm.name.trim()
                if (!name) throw BusinessException.badRequest('projectMeta.name cannot be empty')
                group.projectName = name
            }
            if (pm.goal !== undefined) group.projectGoal = pm.goal?.trim() ? pm.goal.trim() : null
            if (pm.techStack !== undefined) group.projectTechStack = pm.techStack
            if (pm.status !== undefined) group.projectStatus = pm.status
        }
        if (payload.isPinned !== undefined) group.isPinned = payload.isPinned
        if (payload.archived !== undefined) {
            group.status = payload.archived ? 'archived' : 'active'
            group.archivedAt = payload.archived ? (group.archivedAt ?? new Date()) : null
        }
        await this.groupRepo.save(group)

        if (payload.addMemberAgentIds && payload.addMemberAgentIds.length > 0) {
            await this.addMembers(userId, group.id, payload.addMemberAgentIds)
        }

        const members = await this.listMembersWithAgents(group.id)
        const activeRunId = await this.runStream.getActiveRun(group.id)
        return toGroupChatView(group, members, activeRunId)
    }

    async deleteGroupChat(userId: string, id: string): Promise<{ deleted: true }> {
        const group = await this.loadGroup(userId, id)
        const memberSessions = await this.memberRepo.find({
            select: ['agentSessionId'],
            where: { userId, groupChatId: group.id }
        })
        const sessionIds = [
            ...new Set(
                memberSessions
                    .map((member) => member.agentSessionId)
                    .filter((sessionId): sessionId is string => !!sessionId)
            )
        ]
        // 级联删除数据库记录；工作区只标记 inactive，不删除任何目录。
        await this.dataSource.transaction(async (m) => {
            if (sessionIds.length > 0) {
                await m.delete(AgentMessageStep, { sessionId: In(sessionIds) })
                await m.delete(AgentMessage, { userId, sessionId: In(sessionIds) })
                await m.delete(AgentSession, { userId, id: In(sessionIds) })
            }
            await m.delete(GroupChatMember, { groupChatId: group.id })
            await m.delete(GroupMessage, { groupChatId: group.id })
            await m.delete(GroupRun, { groupChatId: group.id })
            await m.delete(BlackboardArtifactEntity, { groupChatId: group.id })
            await m.delete(BlackboardDecisionEntity, { groupChatId: group.id })
            await m.delete(BlackboardContractEntity, { groupChatId: group.id })
            await m.delete(BlackboardTaskEntity, { groupChatId: group.id })
            await m.delete(BlackboardEventEntity, { groupChatId: group.id })
            await m.delete(AgentMemoryItemEntity, { scopeProject: group.id })
            await m.delete(GroupChat, { id: group.id, userId })
        })
        await this.workspace.removeWorkspace(group.id, group.workspaceDir)
        return { deleted: true }
    }

    // —— 装载助手（供编排链路复用）——

    /** 取群实体（NOT_FOUND 校验本人归属） */
    async loadGroup(userId: string, id: string): Promise<GroupChat> {
        const group = await this.groupRepo.findOne({ where: { id, userId } })
        if (!group) throw BusinessException.notFound(`Group chat ${id} not found`)
        return group
    }

    /** 列出群成员实体 */
    async listMembers(groupId: string): Promise<GroupChatMember[]> {
        return this.memberRepo.find({ where: { groupChatId: groupId }, order: { joinedAt: 'ASC' } })
    }

    /** 列出群成员 + 对应 Agent 实体 */
    async listMembersWithAgents(
        groupId: string
    ): Promise<Array<{ member: GroupChatMember; agent: Agent }>> {
        const members = await this.listMembers(groupId)
        if (members.length === 0) return []
        const agents = await this.agentRepo.find({
            where: { id: In([...new Set(members.map((m) => m.agentId))]) }
        })
        const byId = new Map(agents.map((a) => [a.id, a]))
        return members
            .map((member) => {
                const agent = byId.get(member.agentId)
                return agent ? { member, agent } : null
            })
            .filter((x): x is { member: GroupChatMember; agent: Agent } => x !== null)
    }

    /** 持久化成员行的可变字段（如 agentSessionId 懒绑定） */
    async saveMember(member: GroupChatMember): Promise<GroupChatMember> {
        return this.memberRepo.save(member)
    }

    private async addMembers(userId: string, groupId: string, agentIds: string[]): Promise<void> {
        const existing = new Set((await this.listMembers(groupId)).map((m) => m.agentId))
        const toAdd = [...new Set(agentIds)].filter((id) => !existing.has(id))
        if (toAdd.length === 0) return
        const agents = await this.agentRepo.find({ where: { userId, id: In(toAdd) } })
        if (agents.length !== toAdd.length) {
            throw BusinessException.badRequest('Some member Agents do not exist or are not yours')
        }
        const members = agents.map((agent) =>
            this.memberRepo.create({
                userId,
                groupChatId: groupId,
                agentId: agent.id,
                roleInGroup: null,
                agentSessionId: null
            })
        )
        await this.memberRepo.save(members)
    }

    private async assertOrchestratorValid(
        userId: string,
        orchestrator: CreateGroupChatPayload['orchestrator']
    ): Promise<void> {
        let provider
        try {
            provider = await this.providers.resolveRuntimeConfig(userId, orchestrator.providerId)
        } catch {
            throw BusinessException.badRequest(
                `Orchestrator provider ${orchestrator.providerId} not found`
            )
        }
        this.policy.assertVendorProviderCompatible(orchestrator.vendor, provider.type)
        this.policy.assertModelInList(orchestrator.model, provider.modelList)
    }
}
