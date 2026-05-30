import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import { createAgent, getCapabilities, type AgentEvent, type AgentVendor } from './adapter/index.js'
import { AgentSpec } from './entities/agent-spec.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import type { AgentView, CreateAgentResult } from './dto/agent-view.dto.js'
import { specToConfig, toAgentView } from './mappers/agent.mapper.js'
import type { LiveAgent } from './live-agent.js'
import { BusinessException } from '../common/index.js'

/**
 * AgentManager — 虚拟员工的注册表与生命周期管家。
 *
 * 三层模型：AgentSpec（档案，MySQL）/ AgentSession（句柄，MySQL）/ LiveAgent（活实例，内存）。
 * 会话内容由底层 SDK 落盘，这里只持久化句柄（sdkSessionId），因而能扛进程重启：
 * 缺失活实例时按 spec 重建 adapter 并 resumeWith(sdkSessionId) 续接。
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
        @InjectRepository(AgentSpec)
        private readonly specRepo: Repository<AgentSpec>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
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

    // ─────────────────────────── 创建 / 查询 ───────────────────────────

    // TODO: 这个地方的 spec 应该是用户已经创建过的 Agent，应该直接从 user_agent 表中根据 agent_id 查出来
    // 现在还没建这个表，先保持这样
    async createAgentSession(dto: CreateAgentDto): Promise<CreateAgentResult> {
        this.assertConfigSupported(dto)

        const spec = this.specRepo.create({
            vendor: dto.vendor,
            model: dto.model,
            workingDirectory: dto.workingDirectory,
            systemPrompt: dto.systemPrompt ?? null,
            skills: dto.skills ?? null,
            mcpServers: dto.mcpServers ?? null,
            allowedTools: dto.allowedTools ?? null,
            permissionMode: dto.permissionMode ?? null,
            reasoningEffort: dto.reasoningEffort ?? null,
            baseUrl: dto.baseUrl ?? null
        })
        const savedSpec = await this.specRepo.save(spec)

        const session = this.sessionRepo.create({
            specId: savedSpec.id,
            vendor: savedSpec.vendor,
            sdkSessionId: null,
            status: 'active',
            lastTurnAt: null
        })
        const savedSession = await this.sessionRepo.save(session)

        return {
            sessionId: savedSession.id,
            specId: savedSpec.id,
            vendor: savedSpec.vendor,
            capabilities: getCapabilities(savedSpec.vendor)
        }
    }

    async list(): Promise<AgentView[]> {
        const sessions = await this.sessionRepo.find({ order: { createdAt: 'DESC' } })
        if (sessions.length === 0) return []
        const specs = await this.specRepo.find({
            where: { id: In(sessions.map((s) => s.specId)) }
        })
        const specById = new Map(specs.map((sp) => [sp.id, sp]))
        return sessions
            .map((s) => {
                const spec = specById.get(s.specId)
                return spec ? toAgentView(s, spec) : null
            })
            .filter((v): v is AgentView => v !== null)
    }

    async get(sessionId: string): Promise<AgentView> {
        const { session, spec } = await this.loadSessionAndSpec(sessionId)
        return toAgentView(session, spec)
    }

    // ─────────────────────────── 对话（SSE） ───────────────────────────

    /**
     * 与 agent 对话，返回事件流。
     *
     * 同步流程：加载会话 → 取/重建活实例 → 检查并占用 busy（无 await 的 check-and-set，
     * 防并发）→ 返回生成器。生成器负责实际流式转发，并在 finally 回写句柄、释放 busy。
     * 客户端断连时，控制器对返回的迭代器调用 .return()，触发本生成器 finally。
     */
    async converse(
        sessionId: string,
        prompt: string,
        clientSignal?: AbortSignal
    ): Promise<AsyncIterable<AgentEvent>> {
        const { session } = await this.loadSessionAndSpec(sessionId)
        const live = await this.getOrRehydrate(session)

        // check-and-set：此处到置位之间无 await，单线程下原子，避免并发对话交错上下文
        if (live.busy) {
            throw BusinessException.agentBusy(`Agent ${sessionId} is busy with another turn`)
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

    // ─────────────────────── 暂存 / 恢复 / 清空 / 删除 ───────────────────────

    async suspend(sessionId: string): Promise<AgentView> {
        const { session, spec } = await this.loadSessionAndSpec(sessionId)
        this.assertNotBusy(sessionId)
        this.registry.delete(sessionId) // 从内存驱逐；磁盘会话仍在，可后续恢复
        session.status = 'suspended'
        await this.sessionRepo.update({ id: sessionId }, { status: 'suspended' })
        return toAgentView(session, spec)
    }

    async restore(sessionId: string): Promise<AgentView> {
        const { session, spec } = await this.loadSessionAndSpec(sessionId)
        session.status = 'active'
        await this.sessionRepo.update({ id: sessionId }, { status: 'active' })
        await this.getOrRehydrate(session) // 预热活实例（按 sdkSessionId resume）
        return toAgentView(session, spec)
    }

    /**
     * 清空聊天历史 = 丢弃底层会话句柄，下次对话自动开新会话。
     * 注意：这是逻辑清空，SDK 落盘的旧会话文件不会被删除（见 README 已知限制）。
     */
    async clear(sessionId: string): Promise<AgentView> {
        const { session, spec } = await this.loadSessionAndSpec(sessionId)
        this.assertNotBusy(sessionId)
        this.registry.delete(sessionId) // 必须驱逐：活实例内部仍持有旧会话上下文
        session.sdkSessionId = null
        session.status = 'cleared'
        await this.sessionRepo.update({ id: sessionId }, { sdkSessionId: null, status: 'cleared' })
        return toAgentView(session, spec)
    }

    async remove(sessionId: string): Promise<{ deleted: true }> {
        const { session } = await this.loadSessionAndSpec(sessionId)
        this.assertNotBusy(sessionId)
        this.registry.delete(sessionId)
        await this.sessionRepo.delete({ id: session.id })
        // 保留 spec：一份档案可被复用；清理留待 phase-2
        return { deleted: true }
    }

    // ─────────────────────────── 内部工具 ───────────────────────────

    /** 取活实例；缺失则按 spec 重建并 resume。用 in-flight 去重避免并发重复构造。 */
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
        const spec = await this.specRepo.findOne({ where: { id: session.specId } })
        if (!spec) {
            throw BusinessException.agentUnavailable(
                `AgentSpec ${session.specId} missing for session ${session.id}`
            )
        }
        const apiKey = this.resolveApiKey(spec.vendor)
        const config = specToConfig(spec, apiKey, session.id)

        let adapter
        try {
            adapter = createAgent(spec.vendor, config)
        } catch (err) {
            throw BusinessException.agentUnavailable(
                `Failed to create ${spec.vendor} adapter: ${this.errMsg(err)}`
            )
        }
        if (session.sdkSessionId) adapter.resumeWith(session.sdkSessionId)

        return {
            sessionId: session.id,
            specId: spec.id,
            vendor: spec.vendor,
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

    private resolveApiKey(vendor: AgentVendor): string {
        const key =
            vendor === 'claude'
                ? this.config.get<string>('ANTHROPIC_API_KEY')
                : this.config.get<string>('OPENAI_API_KEY')
        if (!key) {
            throw BusinessException.agentUnavailable(`Missing API key for vendor ${vendor}`)
        }
        return key
    }

    /** 创建时校验 vendor 能力，不支持的配置显式报错而非静默丢弃 */
    private assertConfigSupported(dto: CreateAgentDto): void {
        const caps = getCapabilities(dto.vendor)
        const unsupported: string[] = []
        if (dto.systemPrompt && !caps.supportsSystemPrompt) unsupported.push('systemPrompt')
        if (dto.skills && !caps.supportsSkills) unsupported.push('skills')
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

    private async loadSessionAndSpec(
        sessionId: string
    ): Promise<{ session: AgentSession; spec: AgentSpec }> {
        const session = await this.sessionRepo.findOne({ where: { id: sessionId } })
        if (!session) {
            throw BusinessException.notFound(`Agent session ${sessionId} not found`)
        }
        const spec = await this.specRepo.findOne({ where: { id: session.specId } })
        if (!spec) {
            throw BusinessException.agentUnavailable(
                `AgentSpec ${session.specId} missing for session ${sessionId}`
            )
        }
        return { session, spec }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
