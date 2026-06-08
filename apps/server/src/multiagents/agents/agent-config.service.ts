import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import { getCapabilities } from '../adapter/index.js'
import { CreateAgentDto } from '../dto/create-agent.dto.js'
import { UpdateAgentDto } from '../dto/update-agent.dto.js'
import type { AgentView } from '../dto/agent-view.dto.js'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import { toAgentView } from '../mappers/agent.mapper.js'
import { BusinessException } from '../../common/index.js'
import { PlatformProviderService } from '../../platform-provider/platform-provider.service.js'
import { AgentPolicyService } from './agent-policy.service.js'
import { AgentWorkspaceService } from '../workspace/agent-workspace.service.js'
import { AgentRuntimeService } from '../runtime/agent-runtime.service.js'
import { AgentMessageHistoryService } from '../messages/agent-message-history.service.js'
import { UserWorkspaceService } from '../../user-workspace/user-workspace.service.js'

@Injectable()
export class AgentConfigService {
    constructor(
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        private readonly providerService: PlatformProviderService,
        private readonly policy: AgentPolicyService,
        private readonly workspace: AgentWorkspaceService,
        private readonly userWorkspace: UserWorkspaceService,
        private readonly runtime: AgentRuntimeService,
        private readonly messages: AgentMessageHistoryService
    ) {}

    async createAgent(userId: string, dto: CreateAgentDto): Promise<AgentView> {
        this.policy.assertConfigSupported(dto)
        this.policy.assertSkillsShape(dto.skills)
        const caps = getCapabilities(dto.vendor)

        const provider = await this.providerService.resolveRuntimeConfig(
            userId,
            dto.platformProviderId
        )
        this.policy.assertVendorProviderCompatible(dto.vendor, provider.type)
        this.policy.assertModelInList(dto.model, provider.modelList)

        const agentId = randomUUID()
        const workingDirectory = await this.userWorkspace.assertPathInRoot(
            userId,
            'agent_workspace',
            dto.workingDirectory,
            'Agent workingDirectory'
        )
        const agentHomeDirectory = dto.agentHomeDirectory
            ? await this.userWorkspace.assertPathInRoot(
                  userId,
                  'agent_home',
                  dto.agentHomeDirectory,
                  'Agent home directory'
              )
            : await this.userWorkspace.allocateAgentHomeDirectory(userId, agentId)
        const skillSourceDirectories = await this.userWorkspace.assertSkillSourceDirectories(
            userId,
            dto.skillSourceDirectories ?? []
        )
        await this.workspace.ensureRuntimeDirectories(dto.vendor, workingDirectory, agentHomeDirectory)
        const importedSkillNames = caps.supportsSkills
            ? await this.workspace.importSkillSourceDirectories(
                  skillSourceDirectories,
                  this.workspace.vendorSkillsRoot(agentHomeDirectory, dto.vendor)
              )
            : []
        const skills = this.policy.mergeSkills(dto.skills, importedSkillNames)

        const agent = this.agentRepo.create({
            id: agentId,
            userId,
            name: dto.name,
            avatar: dto.avatar ?? null,
            color: this.policy.normalizeColor(dto.color),
            capabilitySummary: this.policy.normalizeNullableText(dto.capabilitySummary, null),
            vendor: dto.vendor,
            platformProviderId: dto.platformProviderId,
            model: dto.model,
            agentHomeDirectory,
            workingDirectory,
            systemPrompt: dto.systemPrompt ?? null,
            skills,
            mcpServers: dto.mcpServers ?? null,
            allowedTools: dto.allowedTools ?? null,
            permissionMode: dto.permissionMode ?? null,
            reasoningEffort: dto.reasoningEffort ?? null
        })
        const saved = await this.agentRepo.save(agent)
        return toAgentView(saved)
    }

    async list(userId: string): Promise<AgentView[]> {
        const agents = await this.agentRepo.find({
            where: { userId },
            order: { createdAt: 'DESC' }
        })
        return agents.map(toAgentView)
    }

    async get(userId: string, agentId: string): Promise<AgentView> {
        return toAgentView(await this.loadAgent(userId, agentId))
    }

    async updateAgent(userId: string, agentId: string, dto: UpdateAgentDto): Promise<AgentView> {
        const agent = await this.loadAgent(userId, agentId)
        const sessions = await this.sessionRepo.find({ where: { agentId, userId } })
        for (const s of sessions) this.runtime.assertNotBusy(s.id)

        const vendor = dto.vendor ?? agent.vendor
        const caps = getCapabilities(vendor)
        const platformProviderId = dto.platformProviderId ?? agent.platformProviderId
        const model = dto.model ?? agent.model
        const workingDirectory =
            dto.workingDirectory !== undefined
                ? await this.userWorkspace.assertPathInRoot(
                      userId,
                      'agent_workspace',
                      dto.workingDirectory,
                      'Agent workingDirectory'
                  )
                : await this.userWorkspace.assertPathInRoot(
                      userId,
                      'agent_workspace',
                      agent.workingDirectory,
                      'Agent workingDirectory'
                  )
        const agentHomeDirectory = await this.userWorkspace.assertPathInRoot(
            userId,
            'agent_home',
            agent.agentHomeDirectory,
            'Agent home directory'
        )
        const systemPrompt = caps.supportsSystemPrompt
            ? this.policy.normalizeNullableText(dto.systemPrompt, agent.systemPrompt)
            : null
        const requestedSkills = caps.supportsSkills
            ? dto.skills !== undefined
                ? dto.skills
                : agent.skills
            : null
        const mcpServers = caps.supportsMcp
            ? dto.mcpServers !== undefined
                ? dto.mcpServers
                : agent.mcpServers
            : null

        this.policy.assertConfigSupported({
            vendor,
            systemPrompt,
            skills: requestedSkills,
            skillSourceDirectories: dto.skillSourceDirectories,
            mcpServers
        })
        this.policy.assertSkillsShape(requestedSkills)

        const provider = await this.providerService.resolveRuntimeConfig(userId, platformProviderId)
        this.policy.assertVendorProviderCompatible(vendor, provider.type)
        this.policy.assertModelInList(model, provider.modelList)
        const skillSourceDirectories = dto.skillSourceDirectories
            ? await this.userWorkspace.assertSkillSourceDirectories(userId, dto.skillSourceDirectories)
            : []

        await this.workspace.ensureRuntimeDirectories(vendor, workingDirectory, agentHomeDirectory)
        const importedSkillNames =
            caps.supportsSkills && dto.skillSourceDirectories
                ? await this.workspace.importSkillSourceDirectories(
                      skillSourceDirectories,
                      this.workspace.vendorSkillsRoot(agentHomeDirectory, vendor)
                  )
                : []
        const skills = caps.supportsSkills
            ? this.policy.mergeSkills(requestedSkills, importedSkillNames)
            : null

        if (dto.name !== undefined) agent.name = dto.name
        if (dto.avatar !== undefined) agent.avatar = dto.avatar ?? null
        if (dto.color !== undefined) agent.color = this.policy.normalizeColor(dto.color)
        if (dto.capabilitySummary !== undefined) {
            agent.capabilitySummary = this.policy.normalizeNullableText(
                dto.capabilitySummary,
                agent.capabilitySummary
            )
        }
        agent.vendor = vendor
        agent.platformProviderId = platformProviderId
        agent.model = model
        agent.agentHomeDirectory = agentHomeDirectory
        agent.workingDirectory = workingDirectory
        agent.systemPrompt = systemPrompt
        agent.skills = skills
        agent.mcpServers = mcpServers
        if (dto.allowedTools !== undefined) agent.allowedTools = dto.allowedTools
        if (dto.permissionMode !== undefined) agent.permissionMode = dto.permissionMode
        if (dto.reasoningEffort !== undefined) agent.reasoningEffort = dto.reasoningEffort

        const saved = await this.agentRepo.save(agent)
        this.runtime.evictSessions(sessions.map((s) => s.id))
        if (sessions.length > 0 && sessions.some((s) => s.vendor !== vendor)) {
            await this.sessionRepo.update({ agentId, userId }, { vendor })
        }
        return toAgentView(saved)
    }

    async remove(userId: string, agentId: string): Promise<{ deleted: true }> {
        const agent = await this.loadAgent(userId, agentId)
        const sessions = await this.sessionRepo.find({ where: { agentId, userId } })
        for (const s of sessions) this.runtime.assertNotBusy(s.id)
        this.runtime.evictSessions(sessions.map((s) => s.id))
        for (const session of sessions) {
            await this.messages.deleteChatHistory(userId, session.id)
        }
        if (sessions.length > 0) await this.sessionRepo.delete({ agentId, userId })
        await this.agentRepo.delete({ id: agent.id, userId })
        return { deleted: true }
    }

    async loadAgent(userId: string, agentId: string): Promise<Agent> {
        const agent = await this.agentRepo.findOne({ where: { id: agentId, userId } })
        if (!agent) {
            throw BusinessException.notFound(`Agent ${agentId} not found`)
        }
        return agent
    }
}
