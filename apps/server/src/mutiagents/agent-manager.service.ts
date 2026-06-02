import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { In, Repository } from 'typeorm'
import { createAgent, getCapabilities, type AgentEvent, type AgentVendor } from './adapter/index.js'
import { Agent } from './entities/agent.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'
import { AgentMessage } from './entities/agent-message.entity.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import { CreateAgentChatDto } from './dto/create-agent-chat.dto.js'
import type { AgentView } from './dto/agent-view.dto.js'
import type { AgentChatView } from './dto/agent-chat-view.dto.js'
import { agentToConfig, toAgentChatView, toAgentView } from './mappers/agent.mapper.js'
import { toAgentChatMessageView } from './mappers/agent-message.mapper.js'
import type { AgentChatMessageView } from './dto/agent-message-view.dto.js'
import type { LiveAgent } from './live-agent.js'
import { BusinessException } from '../common/index.js'
import { PlatformProviderService } from '../platform-provider/platform-provider.service.js'
import type { ProviderType } from '../platform-provider/entities/platform-provider.entity.js'

/**
 * AgentManager — 用户虚拟员工的注册表与单 Agent 聊天生命周期管家。
 *
 * Agent 是可复用配置；AgentSession 是一次具体单聊会话。同一个 Agent 可以创建多条
 * AgentSession，每条都有自己的工作目录、私有 home、SDK 句柄和消息历史。
 */
@Injectable()
export class AgentManager implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AgentManager.name)

    /** sessionId/chatId -> 活实例 */
    private readonly registry = new Map<string, LiveAgent>()
    /** sessionId/chatId -> 重建中的 Promise，去重并发 rehydrate */
    private readonly rehydrating = new Map<string, Promise<LiveAgent>>()

    private readonly maxLive: number
    private readonly maxLiveCodex: number
    private readonly idleTtlMs: number
    private sweepTimer: NodeJS.Timeout | null = null

    constructor(
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        @InjectRepository(AgentMessage)
        private readonly messageRepo: Repository<AgentMessage>,
        private readonly providerService: PlatformProviderService,
        private readonly config: ConfigService
    ) {
        this.maxLive = this.config.get<number>('AGENT_MAX_LIVE', 30)
        this.maxLiveCodex = this.config.get<number>('AGENT_MAX_LIVE_CODEX', 8)
        this.idleTtlMs = this.config.get<number>('AGENT_IDLE_TTL_MS', 15 * 60 * 1000)
    }

    onModuleInit(): void {
        this.sweepTimer = setInterval(() => this.sweepIdle(), Math.min(this.idleTtlMs, 60 * 1000))
        this.sweepTimer.unref?.()
    }

    onModuleDestroy(): void {
        if (this.sweepTimer) clearInterval(this.sweepTimer)
        this.registry.clear()
    }

    // ─────────────────────────── Agent 配置（按用户隔离） ───────────────────────────

    /**
     * 创建一个 Agent（仅落配置，进入该用户的 AgentList，不开聊天会话）。
     */
    async createAgent(userId: string, dto: CreateAgentDto): Promise<AgentView> {
        this.assertConfigSupported(dto)
        this.assertSkillsShape(dto.skills)

        const provider = await this.providerService.resolveRuntimeConfig(
            userId,
            dto.platformProviderId
        )
        this.assertVendorProviderCompatible(dto.vendor, provider.type)
        this.assertModelInList(dto.model, provider.modelList)

        const workingDirectory = this.normalizeDirectoryPath(dto.workingDirectory)
        const agentHomeDirectory = this.normalizeDirectoryPath(
            dto.agentHomeDirectory ?? dto.workingDirectory
        )
        await this.ensureRuntimeDirectories(dto.vendor, workingDirectory, agentHomeDirectory)
        const importedSkillNames =
            dto.vendor === 'claude'
                ? await this.importSkillSourceDirectories(
                      dto.skillSourceDirectories ?? [],
                      agentHomeDirectory
                  )
                : []
        const skills = this.mergeSkills(dto.skills, importedSkillNames)

        const agent = this.agentRepo.create({
            userId,
            name: dto.name,
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

    /** 删除 Agent：连同它的所有单聊会话和消息一并删除。 */
    async remove(userId: string, agentId: string): Promise<{ deleted: true }> {
        const agent = await this.loadAgent(userId, agentId)
        const sessions = await this.sessionRepo.find({ where: { agentId, userId } })
        for (const s of sessions) this.assertNotBusy(s.id)
        for (const s of sessions) this.registry.delete(s.id)
        await this.messageRepo.delete({ agentId, userId })
        if (sessions.length > 0) await this.sessionRepo.delete({ agentId, userId })
        await this.agentRepo.delete({ id: agent.id, userId })
        return { deleted: true }
    }

    // ─────────────────────────── 单 Agent 聊天（AgentSession） ───────────────────────────

    async createChat(userId: string, dto: CreateAgentChatDto): Promise<AgentChatView> {
        const agent = await this.loadAgent(userId, dto.agentId)
        this.assertChatConfigSupported(agent.vendor, dto)

        const workingDirectory = this.normalizeDirectoryPath(dto.workingDirectory)
        const sessionId = randomUUID()
        const sessionHomeDirectory = resolve(
            join(agent.agentHomeDirectory, '.agenthub', 'chats', sessionId)
        )

        await this.ensureRuntimeDirectories(agent.vendor, workingDirectory, sessionHomeDirectory)
        if (agent.vendor === 'claude') {
            await this.copyAgentSkillDirectories(agent.agentHomeDirectory, sessionHomeDirectory)
        }
        const importedSkillNames =
            agent.vendor === 'claude'
                ? await this.importSkillSourceDirectories(
                      dto.skillSourceDirectories ?? [],
                      sessionHomeDirectory
                  )
                : []

        const session = this.sessionRepo.create({
            id: sessionId,
            userId,
            agentId: agent.id,
            vendor: agent.vendor,
            title: this.normalizeTitle(dto.title),
            workingDirectory,
            sessionHomeDirectory,
            skills: this.mergeSkills(agent.skills, importedSkillNames),
            mcpServers: this.mergeMcpServers(agent.mcpServers, dto.mcpServers),
            sdkSessionId: null,
            status: 'active',
            lastTurnAt: null
        })
        const saved = await this.sessionRepo.save(session)
        return toAgentChatView(saved, agent)
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
        return sessions
            .map((session) => {
                const agent = agentById.get(session.agentId)
                return agent ? toAgentChatView(session, agent) : null
            })
            .filter((view): view is AgentChatView => view !== null)
    }

    async getChat(userId: string, chatId: string): Promise<AgentChatView> {
        const { session, agent } = await this.loadChat(userId, chatId)
        return toAgentChatView(session, agent)
    }

    async listChatMessages(userId: string, chatId: string): Promise<AgentChatMessageView[]> {
        const { session } = await this.loadChat(userId, chatId)
        const messages = await this.messageRepo.find({
            where: { userId, sessionId: session.id },
            order: { createdAt: 'ASC', id: 'ASC' }
        })
        return messages.map(toAgentChatMessageView)
    }

    async converseChat(
        userId: string,
        chatId: string,
        prompt: string,
        clientSignal?: AbortSignal
    ): Promise<AsyncIterable<AgentEvent>> {
        const { session } = await this.loadChat(userId, chatId)
        const live = await this.getOrRehydrate(session)

        if (live.busy) {
            throw BusinessException.agentBusy(`Chat ${chatId} is busy with another turn`)
        }
        live.busy = true
        live.lastUsedAt = Date.now()

        const abort = new AbortController()
        live.abort = abort
        if (clientSignal) {
            if (clientSignal.aborted) abort.abort()
            else clientSignal.addEventListener('abort', () => abort.abort(), { once: true })
        }

        try {
            await this.saveMessage(userId, session.agentId, session.id, 'user', prompt)
        } catch (err) {
            live.busy = false
            live.abort = null
            throw err
        }

        return this.streamTurn(session, live, prompt, abort)
    }

    async clearChat(userId: string, chatId: string): Promise<AgentChatView> {
        const { session, agent } = await this.loadChat(userId, chatId)
        this.assertNotBusy(session.id)
        this.registry.delete(session.id)
        session.sdkSessionId = null
        session.status = 'cleared'
        await this.sessionRepo.save(session)
        await this.messageRepo.delete({ userId, sessionId: session.id })
        return toAgentChatView(session, agent)
    }

    async removeChat(userId: string, chatId: string): Promise<{ deleted: true }> {
        const { session } = await this.loadChat(userId, chatId)
        this.assertNotBusy(session.id)
        this.registry.delete(session.id)
        await this.messageRepo.delete({ userId, sessionId: session.id })
        await this.sessionRepo.delete({ id: session.id, userId })
        return { deleted: true }
    }

    private async *streamTurn(
        session: AgentSession,
        live: LiveAgent,
        prompt: string,
        abort: AbortController
    ): AsyncIterable<AgentEvent> {
        const textParts: string[] = []
        let fatalErrorMessage: string | null = null
        let persistedOutput = false
        try {
            for await (const ev of live.adapter.send(prompt, { signal: abort.signal })) {
                if (ev.type === 'text') textParts.push(ev.text)
                else if (ev.type === 'error' && ev.fatal) fatalErrorMessage = ev.message
                yield ev
            }
        } finally {
            live.busy = false
            live.abort = null
            live.lastUsedAt = Date.now()
            try {
                await this.persistHandle(session, live)
            } catch (err) {
                this.logger.error(
                    `Failed to persist session handle ${session.id}: ${this.errMsg(err)}`
                )
            }
            try {
                if (!persistedOutput) {
                    const agentText = textParts.join('').trim()
                    if (agentText) {
                        await this.saveMessage(
                            session.userId,
                            session.agentId,
                            session.id,
                            'agent',
                            agentText
                        )
                    } else if (fatalErrorMessage) {
                        await this.saveMessage(
                            session.userId,
                            session.agentId,
                            session.id,
                            'system',
                            fatalErrorMessage
                        )
                    }
                    persistedOutput = true
                }
            } catch (err) {
                this.logger.error(
                    `Failed to persist message history for session ${session.id}: ${this.errMsg(err)}`
                )
            }
        }
    }

    private async persistHandle(session: AgentSession, live: LiveAgent): Promise<void> {
        const latest = live.adapter.sessionId
        if (latest && latest !== session.sdkSessionId) session.sdkSessionId = latest
        session.status = 'active'
        session.lastTurnAt = new Date()
        await this.sessionRepo.save(session)
    }

    // ─────────────────────────── 内部工具 ───────────────────────────

    private normalizeDirectoryPath(path: string): string {
        const trimmed = path.trim()
        if (!trimmed) throw BusinessException.badRequest('Directory path cannot be empty')
        if (trimmed === '~') return homedir()
        if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
        return resolve(trimmed)
    }

    private normalizeTitle(title: string | undefined): string | null {
        const trimmed = title?.trim() ?? ''
        if (!trimmed) return null
        if (trimmed.length > 128) {
            throw BusinessException.badRequest('Chat title cannot exceed 128 characters')
        }
        return trimmed
    }

    private async ensureRuntimeDirectories(
        vendor: AgentVendor,
        workingDirectory: string,
        agentHomeDirectory: string
    ): Promise<void> {
        try {
            await mkdir(workingDirectory, { recursive: true })
            await mkdir(agentHomeDirectory, { recursive: true })
            if (vendor === 'claude') {
                await mkdir(this.agentSkillsRoot(agentHomeDirectory), { recursive: true })
            }
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare Agent directories: ${this.errMsg(err)}`,
                { workingDirectory, agentHomeDirectory }
            )
        }
    }

    private agentSkillsRoot(agentHomeDirectory: string): string {
        return join(agentHomeDirectory, '.claude', 'skills')
    }

    private async copyAgentSkillDirectories(
        agentHomeDirectory: string,
        sessionHomeDirectory: string
    ): Promise<void> {
        const sourceRoot = this.agentSkillsRoot(agentHomeDirectory)
        if (!(await this.isDirectory(sourceRoot))) return
        const destinationRoot = this.agentSkillsRoot(sessionHomeDirectory)
        try {
            const entries = await readdir(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                const source = join(sourceRoot, entry.name)
                const destination = join(destinationRoot, entry.name)
                await cp(source, destination, {
                    recursive: true,
                    errorOnExist: true,
                    force: false
                })
            }
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to copy Agent skills into chat home: ${this.errMsg(err)}`,
                { sourceRoot, destinationRoot }
            )
        }
    }

    private async importSkillSourceDirectories(
        sourceDirectories: string[],
        agentHomeDirectory: string
    ): Promise<string[]> {
        const importedNames: string[] = []
        const seen = new Set<string>()
        for (const raw of sourceDirectories) {
            const sourceRoot = this.normalizeDirectoryPath(raw)
            const skillDirs = await this.collectSkillDirectories(sourceRoot)
            for (const skillDir of skillDirs) {
                const skill = await this.readSkillMetadata(skillDir)
                if (seen.has(skill.name)) {
                    throw BusinessException.badRequest(`Duplicate skill name "${skill.name}"`, {
                        skillName: skill.name,
                        sourceDirectory: skillDir
                    })
                }
                seen.add(skill.name)
                const destination = join(this.agentSkillsRoot(agentHomeDirectory), skill.name)
                try {
                    await cp(skillDir, destination, {
                        recursive: true,
                        errorOnExist: true,
                        force: false
                    })
                } catch (err) {
                    throw BusinessException.badRequest(
                        `Failed to import skill "${skill.name}": ${this.errMsg(err)}`,
                        { skillName: skill.name, sourceDirectory: skillDir, destination }
                    )
                }
                importedNames.push(skill.name)
            }
        }
        return importedNames
    }

    private async collectSkillDirectories(sourceRoot: string): Promise<string[]> {
        if (await this.hasSkillFile(sourceRoot)) return [sourceRoot]

        const claudeSkillsRoot = join(sourceRoot, '.claude', 'skills')
        if (await this.isDirectory(claudeSkillsRoot)) {
            return this.collectChildSkillDirectories(claudeSkillsRoot)
        }

        const childSkillDirs = await this.collectChildSkillDirectories(sourceRoot)
        if (childSkillDirs.length > 0) return childSkillDirs

        throw BusinessException.badRequest(
            `Skill directory "${sourceRoot}" must contain SKILL.md or skill subdirectories`
        )
    }

    private async collectChildSkillDirectories(parent: string): Promise<string[]> {
        try {
            const entries = await readdir(parent, { withFileTypes: true })
            const skillDirs: string[] = []
            for (const entry of entries) {
                if (!entry.isDirectory()) continue
                const child = join(parent, entry.name)
                if (await this.hasSkillFile(child)) skillDirs.push(child)
            }
            return skillDirs
        } catch (err) {
            throw BusinessException.badRequest(
                `Cannot read skill directory "${parent}": ${this.errMsg(err)}`
            )
        }
    }

    private async readSkillMetadata(skillDirectory: string): Promise<{ name: string }> {
        const skillFile = join(skillDirectory, 'SKILL.md')
        let content: string
        try {
            content = await readFile(skillFile, 'utf8')
        } catch (err) {
            throw BusinessException.badRequest(
                `Cannot read skill file "${skillFile}": ${this.errMsg(err)}`
            )
        }

        const rawName = this.extractSkillName(content) ?? basename(skillDirectory)
        const name = rawName.trim()
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
            throw BusinessException.badRequest(
                `Skill name "${name}" must contain only letters, numbers, ".", "_" or "-"`,
                { skillDirectory, skillFile }
            )
        }
        return { name }
    }

    private extractSkillName(content: string): string | null {
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (!frontmatter) return null
        const nameLine = frontmatter[1].match(/^name:\s*(.+?)\s*$/m)
        if (!nameLine) return null
        return nameLine[1].replace(/^['"]|['"]$/g, '')
    }

    private async hasSkillFile(directory: string): Promise<boolean> {
        try {
            const s = await stat(join(directory, 'SKILL.md'))
            return s.isFile()
        } catch {
            return false
        }
    }

    private async isDirectory(path: string): Promise<boolean> {
        try {
            const s = await stat(path)
            return s.isDirectory()
        } catch {
            return false
        }
    }

    private async saveMessage(
        userId: string,
        agentId: string,
        sessionId: string,
        role: AgentMessage['role'],
        text: string
    ): Promise<void> {
        const trimmed = text.trim()
        if (!trimmed) return
        await this.messageRepo.save(
            this.messageRepo.create({
                userId,
                agentId,
                sessionId,
                role,
                text: trimmed
            })
        )
    }

    private assertSkillsShape(skills: CreateAgentDto['skills']): void {
        if (skills === undefined) return
        if (skills === 'all') return
        if (Array.isArray(skills) && skills.every((s) => typeof s === 'string')) return
        throw BusinessException.badRequest('skills must be "all" or an array of skill names')
    }

    private mergeSkills(
        requested: CreateAgentDto['skills'] | null,
        importedSkillNames: string[]
    ): 'all' | string[] | null {
        if (requested === 'all') return 'all'
        const names = new Set<string>()
        if (Array.isArray(requested)) {
            for (const name of requested) {
                const trimmed = name.trim()
                if (trimmed) names.add(trimmed)
            }
        }
        for (const name of importedSkillNames) names.add(name)
        return names.size > 0 ? [...names] : null
    }

    private mergeMcpServers(
        base: Record<string, unknown> | null,
        override: Record<string, unknown> | undefined
    ): Record<string, unknown> | null {
        const merged = { ...(base ?? {}), ...(override ?? {}) }
        return Object.keys(merged).length > 0 ? merged : null
    }

    private async getOrRehydrate(session: AgentSession): Promise<LiveAgent> {
        const existing = this.registry.get(session.id)
        if (existing) {
            existing.lastUsedAt = Date.now()
            return existing
        }
        const inflight = this.rehydrating.get(session.id)
        if (inflight) return inflight

        const promise = this.buildLiveAgent(session)
            .then((live) => {
                this.evictIfNeeded(live.vendor)
                this.registry.set(session.id, live)
                return live
            })
            .finally(() => this.rehydrating.delete(session.id))

        this.rehydrating.set(session.id, promise)
        return promise
    }

    private async buildLiveAgent(session: AgentSession): Promise<LiveAgent> {
        const agent = await this.agentRepo.findOne({
            where: { id: session.agentId, userId: session.userId }
        })
        if (!agent) {
            throw BusinessException.agentUnavailable(
                `Agent ${session.agentId} missing for chat ${session.id}`
            )
        }

        let provider
        try {
            provider = await this.providerService.resolveRuntimeConfig(
                session.userId,
                agent.platformProviderId
            )
        } catch {
            throw BusinessException.agentUnavailable(
                `Agent ${agent.id} 引用的 Provider ${agent.platformProviderId} 不可用（可能已被删除）`
            )
        }

        const config = agentToConfig(agent, session, provider.apiKey, provider.baseUrl, session.id)

        let adapter
        try {
            adapter = createAgent(agent.vendor, config)
        } catch (err) {
            throw BusinessException.agentUnavailable(
                `Failed to create ${agent.vendor} adapter: ${this.errMsg(err)}`
            )
        }
        if (session.sdkSessionId) adapter.resumeWith(session.sdkSessionId)

        return {
            sessionId: session.id,
            agentId: agent.id,
            vendor: agent.vendor,
            adapter,
            busy: false,
            abort: null,
            lastUsedAt: Date.now()
        }
    }

    private evictIfNeeded(incomingVendor: AgentVendor): void {
        if (incomingVendor === 'codex') {
            this.evictVendorOverCap('codex', this.maxLiveCodex - 1)
        }
        this.evictTotalOverCap(this.maxLive - 1)
    }

    private evictVendorOverCap(vendor: AgentVendor, cap: number): void {
        const ofVendor = [...this.registry.values()].filter((l) => l.vendor === vendor)
        this.evictLruIdle(ofVendor, ofVendor.length - cap)
    }

    private evictTotalOverCap(cap: number): void {
        this.evictLruIdle([...this.registry.values()], this.registry.size - cap)
    }

    private evictLruIdle(candidates: LiveAgent[], count: number): void {
        if (count <= 0) return
        const idle = candidates.filter((l) => !l.busy).sort((a, b) => a.lastUsedAt - b.lastUsedAt)
        for (let i = 0; i < count && i < idle.length; i++) {
            this.registry.delete(idle[i].sessionId)
            this.logger.debug(`Evicted idle live agent ${idle[i].sessionId} (${idle[i].vendor})`)
        }
    }

    private sweepIdle(): void {
        const now = Date.now()
        for (const live of [...this.registry.values()]) {
            if (!live.busy && now - live.lastUsedAt > this.idleTtlMs) {
                this.registry.delete(live.sessionId)
            }
        }
    }

    private assertVendorProviderCompatible(vendor: AgentVendor, type: ProviderType): void {
        const compatible =
            vendor === 'claude'
                ? type === 'anthropic'
                : type === 'openai-responses' || type === 'openai-chat-completions'
        if (!compatible) {
            throw BusinessException.badRequest(
                `vendor "${vendor}" 与 Provider 类型 "${type}" 不兼容`,
                { vendor, providerType: type }
            )
        }
    }

    private assertModelInList(model: string, modelList: string[]): void {
        if (modelList.length > 0 && !modelList.includes(model)) {
            throw BusinessException.badRequest(
                `model "${model}" 不在所引用 Provider 的 modelList 中`,
                { model, modelList }
            )
        }
    }

    private assertConfigSupported(dto: CreateAgentDto): void {
        const caps = getCapabilities(dto.vendor)
        const unsupported: string[] = []
        if (dto.systemPrompt && !caps.supportsSystemPrompt) unsupported.push('systemPrompt')
        if (
            (dto.skills ||
                (dto.skillSourceDirectories !== undefined &&
                    dto.skillSourceDirectories.length > 0)) &&
            !caps.supportsSkills
        ) {
            unsupported.push('skills')
        }
        if (dto.mcpServers && !caps.supportsMcp) unsupported.push('mcpServers')
        if (unsupported.length > 0) {
            throw BusinessException.agentUnavailable(
                `Vendor "${dto.vendor}" does not support: ${unsupported.join(', ')}`,
                { vendor: dto.vendor, unsupported, capabilities: caps }
            )
        }
    }

    private assertChatConfigSupported(vendor: AgentVendor, dto: CreateAgentChatDto): void {
        const caps = getCapabilities(vendor)
        const unsupported: string[] = []
        if ((dto.skillSourceDirectories?.length ?? 0) > 0 && !caps.supportsSkills) {
            unsupported.push('skills')
        }
        if (dto.mcpServers && Object.keys(dto.mcpServers).length > 0 && !caps.supportsMcp) {
            unsupported.push('mcpServers')
        }
        if (unsupported.length > 0) {
            throw BusinessException.agentUnavailable(
                `Vendor "${vendor}" does not support chat config: ${unsupported.join(', ')}`,
                { vendor, unsupported, capabilities: caps }
            )
        }
    }

    private assertNotBusy(sessionId: string): void {
        const live = this.registry.get(sessionId)
        if (live?.busy) {
            throw BusinessException.agentBusy(`Chat ${sessionId} is busy; cannot mutate mid-turn`)
        }
    }

    private async loadAgent(userId: string, agentId: string): Promise<Agent> {
        const agent = await this.agentRepo.findOne({ where: { id: agentId, userId } })
        if (!agent) {
            throw BusinessException.notFound(`Agent ${agentId} not found`)
        }
        return agent
    }

    private async loadChat(
        userId: string,
        chatId: string
    ): Promise<{ agent: Agent; session: AgentSession }> {
        const session = await this.sessionRepo.findOne({ where: { id: chatId, userId } })
        if (!session) {
            throw BusinessException.notFound(`Agent chat ${chatId} not found`)
        }
        const agent = await this.loadAgent(userId, session.agentId)
        return { session, agent }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
