import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { In, Repository } from 'typeorm'
import { getCapabilities, type AgentEvent } from '../adapter/index.js'
import { CreateAgentChatDto } from '../dto/create-agent-chat.dto.js'
import type { AgentChatView } from '../dto/agent-chat-view.dto.js'
import type { AgentChatMessageView } from '../dto/agent-message-view.dto.js'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import { toAgentChatView } from '../mappers/agent.mapper.js'
import { BusinessException } from '../../common/index.js'
import { AgentConfigService } from '../agents/agent-config.service.js'
import { AgentPolicyService } from '../agents/agent-policy.service.js'
import { AgentWorkspaceService } from '../workspace/agent-workspace.service.js'
import { AgentRuntimeService } from '../runtime/agent-runtime.service.js'
import { AgentMessageHistoryService } from '../messages/agent-message-history.service.js'

@Injectable()
export class AgentChatService {
    constructor(
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        private readonly agents: AgentConfigService,
        private readonly policy: AgentPolicyService,
        private readonly workspace: AgentWorkspaceService,
        private readonly runtime: AgentRuntimeService,
        private readonly messages: AgentMessageHistoryService
    ) {}

    async createChat(userId: string, dto: CreateAgentChatDto): Promise<AgentChatView> {
        const agent = await this.agents.loadAgent(userId, dto.agentId)
        this.policy.assertChatConfigSupported(agent.vendor, dto)

        await this.workspace.ensureAgentHomeDirectory(agent.vendor, agent.agentHomeDirectory)
        const workingDirectory = await this.workspace.resolveChatWorkingDirectory(
            agent,
            dto.workingDirectory
        )
        const sessionId = randomUUID()
        const sessionHomeDirectory = resolve(
            join(agent.agentHomeDirectory, '.agenthub', 'chats', sessionId)
        )

        await this.workspace.ensureChatRuntimeDirectories(
            agent.vendor,
            workingDirectory,
            sessionHomeDirectory
        )
        await this.workspace.syncVendorConfigToWorkingDirectory(
            agent.vendor,
            agent.agentHomeDirectory,
            workingDirectory
        )
        const importedSkillNames = getCapabilities(agent.vendor).supportsSkills
            ? await this.workspace.importSkillSourceDirectories(
                  dto.skillSourceDirectories ?? [],
                  this.workspace.vendorSkillsRoot(workingDirectory, agent.vendor)
              )
            : []

        const session = this.sessionRepo.create({
            id: sessionId,
            userId,
            agentId: agent.id,
            vendor: agent.vendor,
            title: this.policy.normalizeTitle(dto.title),
            workingDirectory,
            sessionHomeDirectory,
            skills: this.policy.mergeSkills(agent.skills, importedSkillNames),
            mcpServers: this.policy.mergeMcpServers(agent.mcpServers, dto.mcpServers),
            sdkSessionId: null,
            status: 'active',
            lastTurnAt: null
        })
        const saved = await this.sessionRepo.save(session)
        return toAgentChatView(saved, agent, null)
    }

    async listChats(userId: string): Promise<AgentChatView[]> {
        const sessions = await this.sessionRepo.find({
            where: { userId },
            order: { updatedAt: 'DESC', createdAt: 'DESC' }
        })
        if (sessions.length === 0) return []

        const agents = await this.agentRepo.find({
            where: { userId, id: In([...new Set(sessions.map((s) => s.agentId))]) }
        })
        const agentById = new Map(agents.map((agent) => [agent.id, agent]))
        const activeTurns = await this.runtime.getActiveTurns(sessions.map((s) => s.id))
        return sessions
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

    async listChatMessages(userId: string, chatId: string): Promise<AgentChatMessageView[]> {
        const { session } = await this.loadChat(userId, chatId)
        return this.messages.listChatMessages(userId, session.id)
    }

    async startTurn(
        userId: string,
        chatId: string,
        prompt: string
    ): Promise<{ turnId: string }> {
        const { session } = await this.loadChat(userId, chatId)
        return this.runtime.startTurn(session, prompt)
    }

    async subscribeTurn(
        userId: string,
        chatId: string,
        turnId: string
    ): Promise<AsyncIterable<AgentEvent>> {
        const { session } = await this.loadChat(userId, chatId)
        return this.runtime.subscribeTurn(session, chatId, turnId)
    }

    async abortTurn(
        userId: string,
        chatId: string,
        turnId: string
    ): Promise<{ aborted: true }> {
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
        const session = await this.sessionRepo.findOne({ where: { id: chatId, userId } })
        if (!session) {
            throw BusinessException.notFound(`Agent chat ${chatId} not found`)
        }
        const agent = await this.agents.loadAgent(userId, session.agentId)
        return { session, agent }
    }
}
