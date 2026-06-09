import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { In, Repository } from 'typeorm'
import { getCapabilities, type AgentEvent } from '../adapter/index.js'
import type {
    MessageReplyRef,
    WorkspaceCommitPayload,
    WorkspaceCommitResult,
    WorkspaceDiffSummary
} from '@agenthub/shared'
import { CreateAgentChatDto } from '../dto/create-agent-chat.dto.js'
import { UpdateAgentChatDto } from '../dto/update-agent-chat.dto.js'
import { UpdateAgentMessageDto } from '../dto/update-agent-message.dto.js'
import type { AgentChatView } from '../dto/agent-chat-view.dto.js'
import type { AgentChatMessageView } from '../dto/agent-message-view.dto.js'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import { GroupChatMember } from '../group/entities/group-chat-member.entity.js'
import { toAgentChatView } from '../mappers/agent.mapper.js'
import { BusinessException } from '../../common/index.js'
import { AgentConfigService } from '../agents/agent-config.service.js'
import { AgentPolicyService } from '../agents/agent-policy.service.js'
import { AgentWorkspaceService } from '../workspace/agent-workspace.service.js'
import { WorkspaceDiffService } from '../workspace/workspace-diff.service.js'
import { AgentRuntimeService } from '../runtime/agent-runtime.service.js'
import { AgentMessageHistoryService } from '../messages/agent-message-history.service.js'
import { UserWorkspaceService } from '../../user-workspace/user-workspace.service.js'

@Injectable()
export class AgentChatService {
    constructor(
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        @InjectRepository(GroupChatMember)
        private readonly groupMemberRepo: Repository<GroupChatMember>,
        private readonly agents: AgentConfigService,
        private readonly policy: AgentPolicyService,
        private readonly workspace: AgentWorkspaceService,
        private readonly workspaceDiff: WorkspaceDiffService,
        private readonly userWorkspace: UserWorkspaceService,
        private readonly runtime: AgentRuntimeService,
        private readonly messages: AgentMessageHistoryService
    ) {}

    async createChat(userId: string, dto: CreateAgentChatDto): Promise<AgentChatView> {
        const agent = await this.agents.loadAgent(userId, dto.agentId)
        this.policy.assertChatConfigSupported(agent.vendor, dto)

        const sessionId = randomUUID()
        const agentHomeDirectory = await this.userWorkspace.assertPathInRoot(
            userId,
            'agent_home',
            agent.agentHomeDirectory,
            'Agent home directory'
        )
        const workingDirectory = dto.workingDirectory?.trim()
            ? await this.userWorkspace.assertPathInRoot(
                  userId,
                  'agent_workspace',
                  dto.workingDirectory,
                  'Chat workingDirectory'
              )
            : await this.userWorkspace.allocateChatWorkspaceDirectory(userId, sessionId)
        const sessionHomeDirectory = await this.userWorkspace.allocateSessionHomeDirectory(
            userId,
            sessionId
        )
        const skillSourceDirectories = await this.userWorkspace.assertSkillSourceDirectories(
            userId,
            dto.skillSourceDirectories ?? []
        )

        await this.workspace.ensureAgentHomeDirectory(agent.vendor, agentHomeDirectory)
        await this.workspace.ensureChatRuntimeDirectories(
            agent.vendor,
            workingDirectory,
            sessionHomeDirectory
        )
        await this.workspace.syncVendorConfigToWorkingDirectory(
            agent.vendor,
            agentHomeDirectory,
            workingDirectory
        )
        const importedSkillNames = getCapabilities(agent.vendor).supportsSkills
            ? await this.workspace.importSkillSourceDirectories(
                  skillSourceDirectories,
                  this.workspace.vendorSkillsRoot(workingDirectory, agent.vendor)
              )
            : []

        const session = this.sessionRepo.create({
            id: sessionId,
            userId,
            agentId: agent.id,
            vendor: agent.vendor,
            scope: 'user',
            title: this.policy.normalizeTitle(dto.title),
            workingDirectory,
            sessionHomeDirectory,
            skills: this.policy.mergeSkills(agent.skills, importedSkillNames),
            mcpServers: this.policy.mergeMcpServers(agent.mcpServers, dto.mcpServers),
            sdkSessionId: null,
            status: 'active',
            isPinned: false,
            archivedAt: null,
            lastTurnAt: null
        })
        const saved = await this.sessionRepo.save(session)
        await this.workspaceDiff
            .markCheckpoint(saved.workingDirectory, 'agent-chat', saved.id)
            .catch(() => undefined)
        return toAgentChatView(saved, agent, null)
    }

    async listChats(userId: string): Promise<AgentChatView[]> {
        const groupSessionIds = await this.listGroupMemberSessionIds(userId)
        const sessions = await this.sessionRepo.find({
            where: { userId, scope: 'user' },
            order: { isPinned: 'DESC', updatedAt: 'DESC', createdAt: 'DESC' }
        })
        const userSessions = sessions.filter((session) => !groupSessionIds.has(session.id))
        if (userSessions.length === 0) return []

        const agents = await this.agentRepo.find({
            where: { userId, id: In([...new Set(userSessions.map((s) => s.agentId))]) }
        })
        const agentById = new Map(agents.map((agent) => [agent.id, agent]))
        const activeTurns = await this.runtime.getActiveTurns(userSessions.map((s) => s.id))
        return userSessions
            .map((session) => {
                const agent = agentById.get(session.agentId)
                return agent
                    ? toAgentChatView(session, agent, activeTurns.get(session.id) ?? null)
                    : null
            })
            .filter((view): view is AgentChatView => view !== null)
    }

    async getChat(userId: string, chatId: string): Promise<AgentChatView> {
        const { session, agent } = await this.loadChat(userId, chatId)
        const activeTurnId = await this.runtime.getActiveTurn(session.id)
        return toAgentChatView(session, agent, activeTurnId)
    }

    async updateChat(
        userId: string,
        chatId: string,
        dto: UpdateAgentChatDto
    ): Promise<AgentChatView> {
        const { session, agent } = await this.loadChat(userId, chatId)

        if (dto.isPinned !== undefined) session.isPinned = dto.isPinned
        if (dto.archived !== undefined) {
            session.archivedAt = dto.archived ? (session.archivedAt ?? new Date()) : null
        }

        const saved = await this.sessionRepo.save(session)
        const activeTurnId = await this.runtime.getActiveTurn(session.id)
        return toAgentChatView(saved, agent, activeTurnId)
    }

    async listChatMessages(userId: string, chatId: string): Promise<AgentChatMessageView[]> {
        const { session } = await this.loadChat(userId, chatId)
        return this.messages.listChatMessages(userId, session.id)
    }

    async updateChatMessage(
        userId: string,
        chatId: string,
        messageId: string,
        dto: UpdateAgentMessageDto
    ): Promise<AgentChatMessageView> {
        const { session } = await this.loadChat(userId, chatId)
        return this.messages.updateChatMessage(userId, session.id, messageId, dto)
    }

    async getWorkspaceDiff(userId: string, chatId: string): Promise<WorkspaceDiffSummary> {
        const { session } = await this.loadChat(userId, chatId)
        return this.workspaceDiff.summarize(session.workingDirectory, 'agent-chat', session.id)
    }

    async commitWorkspace(
        userId: string,
        chatId: string,
        payload: WorkspaceCommitPayload
    ): Promise<WorkspaceCommitResult> {
        const { session } = await this.loadChat(userId, chatId)
        const activeTurnId = await this.runtime.getActiveTurn(session.id)
        if (activeTurnId) {
            throw BusinessException.agentBusy(
                `Chat ${chatId} is busy with active turn ${activeTurnId}`
            )
        }
        return this.workspaceDiff.commit(
            session.workingDirectory,
            'agent-chat',
            session.id,
            payload
        )
    }

    async startTurn(
        userId: string,
        chatId: string,
        prompt: string,
        replyTo: MessageReplyRef | null = null
    ): Promise<{ turnId: string }> {
        const { session } = await this.loadChat(userId, chatId)
        if (session.archivedAt) {
            throw BusinessException.forbidden('Archived chat is read-only')
        }
        return this.runtime.startTurn(session, prompt, replyTo)
    }

    async subscribeTurn(
        userId: string,
        chatId: string,
        turnId: string
    ): Promise<AsyncIterable<AgentEvent>> {
        const { session } = await this.loadChat(userId, chatId)
        return this.runtime.subscribeTurn(session, chatId, turnId)
    }

    async abortTurn(userId: string, chatId: string, turnId: string): Promise<{ aborted: true }> {
        const { session } = await this.loadChat(userId, chatId)
        return this.runtime.abortTurn(session, chatId, turnId)
    }

    async clearChat(userId: string, chatId: string): Promise<AgentChatView> {
        const { session, agent } = await this.loadChat(userId, chatId)
        this.runtime.assertNotBusy(session.id)
        this.runtime.evictSession(session.id)
        session.sdkSessionId = null
        session.status = 'cleared'
        await this.sessionRepo.save(session)
        await this.messages.deleteChatHistory(userId, session.id)
        return toAgentChatView(session, agent, null)
    }

    async removeChat(userId: string, chatId: string): Promise<{ deleted: true }> {
        const { session } = await this.loadChat(userId, chatId)
        this.runtime.assertNotBusy(session.id)
        this.runtime.evictSession(session.id)
        await this.messages.deleteChatHistory(userId, session.id)
        await this.sessionRepo.delete({ id: session.id, userId })
        return { deleted: true }
    }

    private async loadChat(
        userId: string,
        chatId: string
    ): Promise<{ agent: Agent; session: AgentSession }> {
        const session = await this.sessionRepo.findOne({
            where: { id: chatId, userId, scope: 'user' }
        })
        if (!session || (await this.isGroupMemberSession(userId, session.id))) {
            throw BusinessException.notFound(`Agent chat ${chatId} not found`)
        }
        const agent = await this.agents.loadAgent(userId, session.agentId)
        return { session, agent }
    }

    private async listGroupMemberSessionIds(userId: string): Promise<Set<string>> {
        const members = await this.groupMemberRepo.find({
            select: ['agentSessionId'],
            where: { userId }
        })
        return new Set(
            members
                .map((member) => member.agentSessionId)
                .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
    }

    private async isGroupMemberSession(userId: string, sessionId: string): Promise<boolean> {
        return (
            (await this.groupMemberRepo.exists({
                where: { userId, agentSessionId: sessionId }
            })) === true
        )
    }
}
