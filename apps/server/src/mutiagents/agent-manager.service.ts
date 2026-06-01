import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { In, Repository } from 'typeorm'
import { createAgent, getCapabilities, type AgentEvent, type AgentVendor } from './adapter/index.js'
import { Agent } from './entities/agent.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import type { AgentView } from './dto/agent-view.dto.js'
import { agentToConfig, toAgentView } from './mappers/agent.mapper.js'
import type { LiveAgent } from './live-agent.js'
import { BusinessException } from '../common/index.js'
import { PlatformProviderService } from '../platform-provider/platform-provider.service.js'
import type { ProviderType } from '../platform-provider/entities/platform-provider.entity.js'

/**
 * AgentManager — 用户虚拟员工的注册表与生命周期管家。
 *
 * 三层模型：Agent（配置，MySQL，归属用户）/ AgentSession（句柄，MySQL）/ LiveAgent（活实例，内存）。
 * Agent 与会话解耦：创建 Agent 只落配置（进 AgentList）；本期单聊按 agentId 懒加载/复用一条会话。
 * 凭证（baseUrl + apiKey）不存 Agent，运行时按 Agent.platformProviderId 从 platform-provider 取。
 * 会话内容由底层 SDK 落盘，这里只持久化句柄（sdkSessionId），因而能扛进程重启：
 * 缺失活实例时按 Agent 配置重建 adapter 并 resumeWith(sdkSessionId) 续接。
 */
@Injectable()
export class AgentManager implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AgentManager.name)

    /** sessionId → 活实例 */
    private readonly registry = new Map<string, LiveAgent>()
    /** sessionId → 重建中的 Promise，去重并发 rehydrate */
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
        private readonly providerService: PlatformProviderService,
        private readonly config: ConfigService
    ) {
        this.maxLive = this.config.get<number>('AGENT_MAX_LIVE', 30)
        this.maxLiveCodex = this.config.get<number>('AGENT_MAX_LIVE_CODEX', 8)
        this.idleTtlMs = this.config.get<number>('AGENT_IDLE_TTL_MS', 15 * 60 * 1000)
    }

    onModuleInit(): void {
        // 周期性清扫空闲活实例（非 busy 且超过 idle TTL）。unref 避免阻塞退出。
        this.sweepTimer = setInterval(() => this.sweepIdle(), Math.min(this.idleTtlMs, 60 * 1000))
        this.sweepTimer.unref?.()
    }

    onModuleDestroy(): void {
        if (this.sweepTimer) clearInterval(this.sweepTimer)
        // 进程关闭：丢弃所有活实例（底层 SDK 子进程随 GC/进程退出回收）
        this.registry.clear()
    }

    // ─────────────────────────── 创建 / 查询（按用户隔离） ───────────────────────────

    /**
     * 创建一个 Agent（仅落配置，进入该用户的 AgentList，不开会话）。
     *
     * 校验：vendor 能力支持配置；所引用 Provider 存在且本人所有；vendor 与 Provider 类型兼容；
     * model 属于该 Provider 的 modelList（modelList 为空时跳过）。
     */
    async createAgent(userId: string, dto: CreateAgentDto): Promise<AgentView> {
        this.assertConfigSupported(dto)
        this.assertSkillsShape(dto.skills)

        // 取所引用 Provider 的运行时配置：顺带校验其存在且归属本人（否则 NOT_FOUND）
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
        return toAgentView(saved, null)
    }

    /** 列出当前用户的全部 Agent（AgentList），附带各自单聊会话的运行时状态。 */
    async list(userId: string): Promise<AgentView[]> {
        const agents = await this.agentRepo.find({
            where: { userId },
            order: { createdAt: 'DESC' }
        })
        if (agents.length === 0) return []
        const sessions = await this.sessionRepo.find({
            where: { agentId: In(agents.map((a) => a.id)) }
        })
        const sessionByAgent = new Map(sessions.map((s) => [s.agentId, s]))
        return agents.map((a) => toAgentView(a, sessionByAgent.get(a.id) ?? null))
    }

    async get(userId: string, agentId: string): Promise<AgentView> {
        const agent = await this.loadAgent(userId, agentId)
        const session = await this.findSoloSession(userId, agentId)
        return toAgentView(agent, session)
    }

    // ─────────────────────────── 对话（SSE） ───────────────────────────

    /**
     * 与某个 Agent 对话（单聊），返回事件流。
     *
     * 同步流程：取/建单聊会话 → 取/重建活实例 → 检查并占用 busy（无 await 的 check-and-set，
     * 防并发）→ 返回生成器。生成器负责实际流式转发，并在 finally 回写句柄、释放 busy。
     * 客户端断连时，控制器对返回的迭代器调用 .return()，触发本生成器 finally。
     */
    async converse(
        userId: string,
        agentId: string,
        prompt: string,
        clientSignal?: AbortSignal
    ): Promise<AsyncIterable<AgentEvent>> {
        const { session } = await this.getOrCreateSoloSession(userId, agentId)
        const live = await this.getOrRehydrate(session)

        // check-and-set：此处到置位之间无 await，单线程下原子，避免并发对话交错上下文
        if (live.busy) {
            throw BusinessException.agentBusy(`Agent ${agentId} is busy with another turn`)
        }
        live.busy = true
        live.lastUsedAt = Date.now()

        const abort = new AbortController()
        live.abort = abort
        if (clientSignal) {
            if (clientSignal.aborted) abort.abort()
            else clientSignal.addEventListener('abort', () => abort.abort(), { once: true })
        }

        return this.streamTurn(session, live, prompt, abort)
    }

    private async *streamTurn(
        session: AgentSession,
        live: LiveAgent,
        prompt: string,
        abort: AbortController
    ): AsyncIterable<AgentEvent> {
        try {
            for await (const ev of live.adapter.send(prompt, { signal: abort.signal })) {
                yield ev
            }
        } finally {
            // 无论正常结束还是客户端断连(.return())，都收尾：
            // 仅在 turn 结束后持久化句柄（绝不在流中途写，避免崩溃留半截）
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
        }
    }

    /** 回写底层 sdkSessionId（首轮捕获 / resume 轮换）+ lastTurnAt + status=active */
    private async persistHandle(session: AgentSession, live: LiveAgent): Promise<void> {
        const latest = live.adapter.sessionId
        const patch: Partial<AgentSession> = { lastTurnAt: new Date(), status: 'active' }
        if (latest && latest !== session.sdkSessionId) {
            patch.sdkSessionId = latest
            session.sdkSessionId = latest
        }
        session.status = 'active'
        session.lastTurnAt = patch.lastTurnAt!
        await this.sessionRepo.update({ id: session.id }, patch)
    }

    // ─────────────────────── 暂存 / 恢复 / 清空 / 删除（按用户隔离） ───────────────────────

    /** 暂存单聊会话：从内存驱逐，可恢复。无会话则为 no-op（返回 none 视图）。 */
    async suspend(userId: string, agentId: string): Promise<AgentView> {
        const agent = await this.loadAgent(userId, agentId)
        const session = await this.findSoloSession(userId, agentId)
        if (!session) return toAgentView(agent, null)
        this.assertNotBusy(session.id)
        this.registry.delete(session.id) // 从内存驱逐；磁盘会话仍在，可后续恢复
        session.status = 'suspended'
        await this.sessionRepo.update({ id: session.id }, { status: 'suspended' })
        return toAgentView(agent, session)
    }

    /** 恢复单聊会话：用 Agent 配置重建 adapter 并续接底层会话；无会话则新建并预热。 */
    async restore(userId: string, agentId: string): Promise<AgentView> {
        const { agent, session } = await this.getOrCreateSoloSession(userId, agentId)
        session.status = 'active'
        await this.sessionRepo.update({ id: session.id }, { status: 'active' })
        await this.getOrRehydrate(session) // 预热活实例（按 sdkSessionId resume）
        return toAgentView(agent, session)
    }

    /**
     * 清空聊天历史 = 丢弃底层会话句柄，下次对话自动开新会话。无会话则为 no-op。
     * 注意：这是逻辑清空，SDK 落盘的旧会话文件不会被删除（见 README 已知限制）。
     */
    async clear(userId: string, agentId: string): Promise<AgentView> {
        const agent = await this.loadAgent(userId, agentId)
        const session = await this.findSoloSession(userId, agentId)
        if (!session) return toAgentView(agent, null)
        this.assertNotBusy(session.id)
        this.registry.delete(session.id) // 必须驱逐：活实例内部仍持有旧会话上下文
        session.sdkSessionId = null
        session.status = 'cleared'
        await this.sessionRepo.update({ id: session.id }, { sdkSessionId: null, status: 'cleared' })
        return toAgentView(agent, session)
    }

    /** 删除 Agent：连同其会话一并删除，并驱逐相关活实例。 */
    async remove(userId: string, agentId: string): Promise<{ deleted: true }> {
        const agent = await this.loadAgent(userId, agentId)
        const sessions = await this.sessionRepo.find({ where: { agentId, userId } })
        for (const s of sessions) this.assertNotBusy(s.id) // 任一会话进行中则整体拒绝
        for (const s of sessions) this.registry.delete(s.id)
        if (sessions.length > 0) await this.sessionRepo.delete({ agentId, userId })
        await this.agentRepo.delete({ id: agent.id, userId })
        return { deleted: true }
    }

    // ─────────────────────────── 内部工具 ───────────────────────────

    private normalizeDirectoryPath(path: string): string {
        const trimmed = path.trim()
        if (!trimmed) throw BusinessException.badRequest('Directory path cannot be empty')
        if (trimmed === '~') return homedir()
        if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
        return resolve(trimmed)
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

    private assertSkillsShape(skills: CreateAgentDto['skills']): void {
        if (skills === undefined) return
        if (skills === 'all') return
        if (Array.isArray(skills) && skills.every((s) => typeof s === 'string')) return
        throw BusinessException.badRequest('skills must be "all" or an array of skill names')
    }

    private mergeSkills(
        requested: CreateAgentDto['skills'],
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

    /** 取活实例；缺失则按 Agent 配置重建并 resume。用 in-flight 去重避免并发重复构造。 */
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
        const agent = await this.agentRepo.findOne({ where: { id: session.agentId } })
        if (!agent) {
            throw BusinessException.agentUnavailable(
                `Agent ${session.agentId} missing for session ${session.id}`
            )
        }

        // 运行时凭证来自所引用 Provider；Provider 被删/不可用 → 该 Agent 不可用
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

        const config = agentToConfig(agent, provider.apiKey, provider.baseUrl, session.id)

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

    /** 容量控制：超过上限时驱逐 LRU 的空闲(非 busy)活实例。Codex 子进程较重，单独限额。 */
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

    /** 校验 vendor 与 Provider 接入类型兼容：claude↔anthropic；codex↔openai-*。 */
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

    /** 校验所选 model 属于该 Provider 的 modelList（modelList 为空时无法校验，放行）。 */
    private assertModelInList(model: string, modelList: string[]): void {
        if (modelList.length > 0 && !modelList.includes(model)) {
            throw BusinessException.badRequest(
                `model "${model}" 不在所引用 Provider 的 modelList 中`,
                { model, modelList }
            )
        }
    }

    /** 创建时校验 vendor 能力，不支持的配置显式报错而非静默丢弃 */
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

    private assertNotBusy(sessionId: string): void {
        const live = this.registry.get(sessionId)
        if (live?.busy) {
            throw BusinessException.agentBusy(`Agent ${sessionId} is busy; cannot mutate mid-turn`)
        }
    }

    /** 按 (userId, agentId) 取 Agent；不存在或非本人 → NOT_FOUND。 */
    private async loadAgent(userId: string, agentId: string): Promise<Agent> {
        const agent = await this.agentRepo.findOne({ where: { id: agentId, userId } })
        if (!agent) {
            throw BusinessException.notFound(`Agent ${agentId} not found`)
        }
        return agent
    }

    /** 取某 Agent 的单聊会话（本期一个 Agent 至多一条）；无则 null。 */
    private findSoloSession(userId: string, agentId: string): Promise<AgentSession | null> {
        return this.sessionRepo.findOne({ where: { agentId, userId } })
    }

    /** 取/建某 Agent 的单聊会话（顺带校验 Agent 归属本人）。 */
    private async getOrCreateSoloSession(
        userId: string,
        agentId: string
    ): Promise<{ agent: Agent; session: AgentSession }> {
        const agent = await this.loadAgent(userId, agentId)
        let session = await this.findSoloSession(userId, agentId)
        if (!session) {
            session = await this.sessionRepo.save(
                this.sessionRepo.create({
                    userId,
                    agentId,
                    vendor: agent.vendor,
                    sdkSessionId: null,
                    status: 'active',
                    lastTurnAt: null
                })
            )
        }
        return { agent, session }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
