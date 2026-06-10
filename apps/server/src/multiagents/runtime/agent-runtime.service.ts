import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { createAgent, type AgentEvent, type AgentVendor } from '../adapter/index.js'
import { LOCAL_DEFAULT_MODEL, type LocalRunConfig, type MessageReplyRef } from '@agenthub/shared'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import type { LiveAgent } from '../live-agent.js'
import { agentToConfig } from '../mappers/agent.mapper.js'
import { TurnStream } from './turn-stream.service.js'
import { BusinessException } from '../../common/index.js'
import { PlatformProviderService } from '../../platform-provider/platform-provider.service.js'
import { LocalRunnerGateway } from '../local-runner/local-runner.gateway.js'
import { RemoteAgentAdapter } from '../local-runner/remote-agent.adapter.js'
import {
    AgentMessageHistoryService,
    type StepDraft
} from '../messages/agent-message-history.service.js'
import { AgentArtifactService } from './agent-artifact.service.js'
import type { BlackboardArtifact, DeployManifest } from '@agenthub/shared'

interface RunningTurn {
    sessionId: string
    abort: AbortController
}

const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1000

@Injectable()
export class AgentRuntimeService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AgentRuntimeService.name)

    private readonly registry = new Map<string, LiveAgent>()
    private readonly rehydrating = new Map<string, Promise<LiveAgent>>()
    private readonly runningTurns = new Map<string, RunningTurn>()

    private readonly maxLive: number
    private readonly maxLiveCodex: number
    private readonly idleTtlMs: number
    private readonly turnTimeoutMs: number
    private sweepTimer: NodeJS.Timeout | null = null

    constructor(
        @InjectRepository(Agent)
        private readonly agentRepo: Repository<Agent>,
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        private readonly providerService: PlatformProviderService,
        private readonly turnStream: TurnStream,
        private readonly messages: AgentMessageHistoryService,
        private readonly config: ConfigService,
        private readonly localRunner: LocalRunnerGateway,
        private readonly artifacts: AgentArtifactService
    ) {
        this.maxLive = this.config.get<number>('AGENT_MAX_LIVE', 30)
        this.maxLiveCodex = this.config.get<number>('AGENT_MAX_LIVE_CODEX', 8)
        this.idleTtlMs = this.config.get<number>('AGENT_IDLE_TTL_MS', 15 * 60 * 1000)
        this.turnTimeoutMs = this.readPositiveMs('AGENT_TURN_TIMEOUT_MS', DEFAULT_TURN_TIMEOUT_MS)
    }

    onModuleInit(): void {
        this.sweepTimer = setInterval(() => this.sweepIdle(), Math.min(this.idleTtlMs, 60 * 1000))
        this.sweepTimer.unref?.()
        this.turnStream.onAbortRequest((turnId) => {
            this.runningTurns.get(turnId)?.abort.abort()
        })
        if (this.config.get<string>('AGENT_RECLAIM_ON_BOOT', 'true') !== 'false') {
            void this.turnStream
                .reclaimStaleActiveTurns()
                .then((n) => {
                    if (n > 0) this.logger.log(`Reclaimed ${n} stale active turn(s) on boot`)
                })
                .catch((err) => {
                    this.logger.error(`Failed to reclaim stale active turns: ${this.errMsg(err)}`)
                })
        }
    }

    onModuleDestroy(): void {
        if (this.sweepTimer) clearInterval(this.sweepTimer)
        this.registry.clear()
    }

    async startTurn(
        session: AgentSession,
        prompt: string,
        replyTo: MessageReplyRef | null = null
    ): Promise<{ turnId: string }> {
        return this.startPromptTurn(session, prompt, replyTo, { saveUserMessage: true })
    }

    async regenerateTurn(
        session: AgentSession,
        prompt: string,
        replyTo: MessageReplyRef | null = null
    ): Promise<{ turnId: string }> {
        return this.startPromptTurn(session, prompt, replyTo, { saveUserMessage: false })
    }

    private async startPromptTurn(
        session: AgentSession,
        prompt: string,
        replyTo: MessageReplyRef | null,
        options: { saveUserMessage: boolean }
    ): Promise<{ turnId: string }> {
        const turnId = randomUUID()
        const owned = await this.turnStream.acquireActiveTurn(session.id, turnId)
        if (owned !== turnId) {
            throw BusinessException.agentBusy(
                `Chat ${session.id} is busy with active turn ${owned}`
            )
        }

        let live: LiveAgent
        try {
            live = await this.getOrRehydrate(session)
        } catch (err) {
            await this.turnStream.abandonTurn(session.id, turnId)
            throw err
        }
        if (live.busy) {
            await this.turnStream.abandonTurn(session.id, turnId)
            throw BusinessException.agentBusy(`Chat ${session.id} is busy with another turn`)
        }
        live.busy = true
        live.lastUsedAt = Date.now()

        const abort = new AbortController()
        live.abort = abort
        this.runningTurns.set(turnId, { sessionId: session.id, abort })

        if (options.saveUserMessage) {
            try {
                // 落库存「干净原文 + 引用快照」，刷新后据 replyTo 重渲染引用气泡。
                await this.messages.saveMessage(
                    session.userId,
                    session.agentId,
                    session.id,
                    'user',
                    prompt,
                    replyTo
                )
            } catch (err) {
                live.busy = false
                live.abort = null
                this.runningTurns.delete(turnId)
                await this.turnStream.abandonTurn(session.id, turnId)
                throw err
            }
        }

        let sdkPrompt: string
        try {
            // 发给 SDK 的 prompt 拼 pinned 全局上下文 + 引用前言；二者不落库。
            sdkPrompt = await this.buildSdkPrompt(session, prompt, replyTo)
        } catch (err) {
            live.busy = false
            live.abort = null
            this.runningTurns.delete(turnId)
            await this.turnStream.abandonTurn(session.id, turnId)
            throw err
        }
        void this.runTurn(session, live, sdkPrompt, abort, turnId)
        return { turnId }
    }

    private async buildSdkPrompt(
        session: AgentSession,
        prompt: string,
        replyTo: MessageReplyRef | null
    ): Promise<string> {
        const pinnedContext = await this.messages.pinnedContext(session.userId, session.id)
        const quotedPrompt = await this.buildQuotedPrompt(session, prompt, replyTo)
        return [pinnedContext, quotedPrompt].filter(Boolean).join('\n\n')
    }

    /** 单聊引用前言：被引用消息原文（服务端为准，回退 excerpt）作为 `>` 引用块拼到 prompt 前。 */
    private async buildQuotedPrompt(
        session: AgentSession,
        prompt: string,
        replyTo: MessageReplyRef | null
    ): Promise<string> {
        if (!replyTo?.messageId) return prompt
        const resolved = await this.messages
            .getMessageText(session.userId, session.id, replyTo.messageId)
            .catch(() => null)
        const quoted = (resolved ?? replyTo.excerpt ?? '').trim()
        if (!quoted) return prompt
        const sender = replyTo.senderName?.trim() || '未知'
        return [
            `> [引用 ${sender}]`,
            ...quoted.split('\n').map((line) => `> ${line}`),
            '',
            prompt
        ].join('\n')
    }

    async subscribeTurn(
        session: AgentSession,
        chatId: string,
        turnId: string
    ): Promise<AsyncIterable<AgentEvent>> {
        if (!(await this.turnStream.isTurnInSession(session.id, turnId))) {
            throw BusinessException.notFound(`Turn ${turnId} does not belong to chat ${chatId}`)
        }
        return this.turnStream.subscribe(chatId, turnId)
    }

    async abortTurn(
        session: AgentSession,
        chatId: string,
        turnId: string
    ): Promise<{ aborted: true }> {
        if (!(await this.turnStream.isTurnInSession(session.id, turnId))) {
            throw BusinessException.notFound(`Turn ${turnId} does not belong to chat ${chatId}`)
        }
        this.runningTurns.get(turnId)?.abort.abort()
        await this.turnStream.requestAbort(turnId)
        return { aborted: true }
    }

    async getActiveTurn(sessionId: string): Promise<string | null> {
        return this.turnStream.getActiveTurn(sessionId)
    }

    async getActiveTurns(sessionIds: string[]): Promise<Map<string, string>> {
        return this.turnStream.getActiveTurns(sessionIds)
    }

    assertNotBusy(sessionId: string): void {
        const live = this.registry.get(sessionId)
        if (live?.busy) {
            throw BusinessException.agentBusy(`Chat ${sessionId} is busy; cannot mutate mid-turn`)
        }
    }

    evictSession(sessionId: string): void {
        this.registry.delete(sessionId)
    }

    evictSessions(sessionIds: string[]): void {
        for (const sessionId of sessionIds) this.registry.delete(sessionId)
    }

    private async runTurn(
        session: AgentSession,
        live: LiveAgent,
        prompt: string,
        abort: AbortController,
        turnId: string
    ): Promise<void> {
        const textParts: string[] = []
        let finalTextFromDone: string | null = null
        let fatalErrorMessage: string | null = null
        let terminalDone: Extract<AgentEvent, { type: 'done' }> | null = null
        let timedOut = false
        let timeout: NodeJS.Timeout | null = null
        const stepDrafts: StepDraft[] = []
        const toolIndexById = new Map<string, number>()
        // 仅用户单聊推导产物;turn 开始抓基线快照,结束据增量推导(group 内部会话不走这里)。
        const artifactBaseline =
            session.scope === 'user' ? await this.artifacts.snapshot(session) : null
        const timeoutPromise =
            this.turnTimeoutMs > 0
                ? new Promise<never>((_, reject) => {
                      timeout = setTimeout(() => {
                          timedOut = true
                          abort.abort()
                          reject(new Error(`Agent turn timed out after ${this.turnTimeoutMs}ms`))
                      }, this.turnTimeoutMs)
                      timeout.unref?.()
                  })
                : null
        try {
            const iterator = live.adapter
                .send(prompt, { signal: abort.signal })
                [Symbol.asyncIterator]()
            while (true) {
                const next = timeoutPromise
                    ? await Promise.race([iterator.next(), timeoutPromise])
                    : await iterator.next()
                if (next.done) break
                const ev = next.value
                if (ev.type === 'done') {
                    terminalDone = ev
                    if (ev.finalText) finalTextFromDone = ev.finalText
                    continue
                }
                if (ev.type === 'text') textParts.push(ev.text)
                else if (ev.type === 'error' && ev.fatal) fatalErrorMessage = ev.message
                else this.messages.collectStep(ev, stepDrafts, toolIndexById)
                await this.turnStream.publish(turnId, ev)
            }
        } catch (err) {
            fatalErrorMessage ??= this.errMsg(err)
            terminalDone = {
                type: 'done',
                vendor: session.vendor,
                success: false
            }
            await this.turnStream
                .publish(turnId, {
                    type: 'error',
                    vendor: session.vendor,
                    message: fatalErrorMessage,
                    fatal: true
                })
                .catch(() => undefined)
        } finally {
            if (timeout) clearTimeout(timeout)
            live.busy = false
            live.abort = null
            live.lastUsedAt = Date.now()
            this.runningTurns.delete(turnId)
            if (timedOut) this.registry.delete(session.id)
            try {
                await this.persistHandle(session, live)
            } catch (err) {
                this.logger.error(
                    `Failed to persist session handle ${session.id}: ${this.errMsg(err)}`
                )
            }
            try {
                const agentText = (finalTextFromDone ?? textParts.join('')).trim()
                if (agentText) {
                    let derivedArtifacts: BlackboardArtifact[] = []
                    let derivedManifest: DeployManifest | null = null
                    if (artifactBaseline) {
                        const derived = await this.artifacts.derive(session, artifactBaseline)
                        derivedArtifacts = derived.artifacts
                        derivedManifest = derived.manifest
                    }
                    const message = await this.messages.saveMessage(
                        session.userId,
                        session.agentId,
                        session.id,
                        'agent',
                        agentText,
                        null,
                        { artifacts: derivedArtifacts, deployManifest: derivedManifest }
                    )
                    if (message) await this.messages.saveSteps(message.id, session.id, stepDrafts)
                } else if (fatalErrorMessage) {
                    await this.messages.saveMessage(
                        session.userId,
                        session.agentId,
                        session.id,
                        'system',
                        fatalErrorMessage
                    )
                }
            } catch (err) {
                this.logger.error(
                    `Failed to persist message history for session ${session.id}: ${this.errMsg(err)}`
                )
            }
            await this.turnStream.releaseActiveTurn(session.id, turnId).catch(() => undefined)
            const finalText = (finalTextFromDone ?? textParts.join('')).trim()
            const done: Extract<AgentEvent, { type: 'done' }> = {
                type: 'done',
                vendor: session.vendor,
                success: terminalDone
                    ? terminalDone.success && !fatalErrorMessage
                    : !fatalErrorMessage,
                ...(finalText ? { finalText } : {}),
                ...(terminalDone?.usage ? { usage: terminalDone.usage } : {})
            }
            await this.turnStream.publish(turnId, done).catch(() => undefined)
            await this.turnStream.finalize(turnId).catch(() => undefined)
        }
    }

    private async persistHandle(session: AgentSession, live: LiveAgent): Promise<void> {
        const latest = live.adapter.sessionId
        if (latest && latest !== session.sdkSessionId) session.sdkSessionId = latest
        // local 会话：记录本轮执行所在设备，用于下次 resume 的设备亲和判断。
        if (session.executionMode === 'local') {
            const deviceId = this.localRunner.deviceId(session.userId)
            if (deviceId && deviceId !== session.deviceId) session.deviceId = deviceId
        }
        session.status = 'active'
        session.lastTurnAt = new Date()
        await this.sessionRepo.save(session)
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

        const adapter =
            agent.executionMode === 'local'
                ? this.buildLocalAdapter(agent, session)
                : await this.buildServerAdapter(agent, session)

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

    /** server 执行模式：在服务器进程内通过 SDK 子进程跑（现状）。 */
    private async buildServerAdapter(agent: Agent, session: AgentSession) {
        if (!agent.platformProviderId) {
            throw BusinessException.agentUnavailable(
                `Agent ${agent.id} has no platform provider for server execution`
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
        try {
            return createAgent(agent.vendor, config)
        } catch (err) {
            throw BusinessException.agentUnavailable(
                `Failed to create ${agent.vendor} adapter: ${this.errMsg(err)}`
            )
        }
    }

    /**
     * local 执行模式：把 turn 转发到用户桌面端本机执行（RemoteAgentAdapter）。
     * 设备未连接 / 未提供该 vendor 引擎时拒绝，提示用户打开桌面端。
     *
     * TODO(安全): 本地模式下服务器仍可让本机 agent 在 bypassPermissions / danger-full-access
     * 下跑任意命令（等于服务器对用户机器有 RCE 能力）。v1 沿用 Agent 配置的 permissionMode，
     * 后续应在桌面端加本地权限审批，并对 local 模式收紧默认权限。
     */
    private buildLocalAdapter(agent: Agent, session: AgentSession): RemoteAgentAdapter {
        if (!this.localRunner.isConnected(session.userId, agent.vendor)) {
            throw BusinessException.agentUnavailable(
                `本地 runner 未连接或未提供 ${agent.vendor} 引擎；请在桌面端打开 AgentHub 并确认本机已安装对应 CLI`
            )
        }
        const runConfig: LocalRunConfig = {
            id: session.id,
            ...(agent.model !== LOCAL_DEFAULT_MODEL ? { model: agent.model } : {}),
            workingDirectory: session.workingDirectory,
            reasoningEffort: (agent.reasoningEffort as LocalRunConfig['reasoningEffort']) ?? undefined,
            systemPrompt: agent.systemPrompt ?? undefined,
            skills: session.skills ?? undefined,
            mcpServers: session.mcpServers ?? undefined,
            allowedTools: agent.allowedTools ?? undefined,
            permissionMode: agent.permissionMode ?? undefined
        }
        return new RemoteAgentAdapter(agent.vendor, this.localRunner, session.userId, runConfig)
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

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }

    private readPositiveMs(key: string, fallback: number): number {
        const raw = this.config.get<string | number>(key)
        if (raw === undefined || raw === null || raw === '') return fallback
        const n = Number(raw)
        return Number.isFinite(n) && n > 0 ? n : fallback
    }
}
