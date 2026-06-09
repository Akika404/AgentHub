import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AgentEvent, AgentOutputSchema } from '../../adapter/index.js'
import { createAgent } from '../../adapter/index.js'
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
import { GroupMessageService } from '../group-message.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'

export interface MemberChatParams {
    group: GroupChat
    userId: string
    runId: string
    instruction: string
    agent: Agent
    member: GroupChatMember
    signal: AbortSignal
}

export interface MemberChatResult {
    success: boolean
    summary: string
}

const LIGHTWEIGHT_CHAT_SCHEMA: AgentOutputSchema = {
    type: 'object',
    properties: {
        text: { type: 'string' }
    },
    required: ['text'],
    additionalProperties: false
}

const LIGHTWEIGHT_CHAT_TIMEOUT_MS = 2 * 60 * 1000

export function normalizeMemberChatStreamEvent(ev: AgentEvent): AgentEvent {
    if (ev.type === 'text') {
        return { ...ev, text: displayTextFrom(ev.text) ?? ev.text }
    }
    if (ev.type === 'turn_completed' || ev.type === 'done') {
        const finalText = displayTextFrom(ev.finalText, ev.structuredOutput)
        return finalText ? { ...ev, finalText } : ev
    }
    return ev
}

function displayTextFrom(rawText?: string, structuredOutput?: unknown): string | null {
    return parseStructuredText(structuredOutput) ?? parseJsonTextField(rawText) ?? rawText ?? null
}

function parseStructuredText(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) return null
    const text = (raw as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text.trim() : null
}

function parseJsonTextField(raw: string | null | undefined): string | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw) as unknown
        return parseStructuredText(parsed)
    } catch {
        return null
    }
}

/**
 * MemberChatService — 真实调用成员 Agent 做轻量聊天回复。
 *
 * 与 DispatchService 不同：不创建黑板 task，不建 task worktree，不装配黑板上下文，
 * 不要求 report，不做 git diff/产出物写回。它只把成员真实回复落到 presentation_log
 * 和成员私有会话历史，用于「大家打个招呼 / 请产品经理给一句看法」这类轻量场景。
 */
@Injectable()
export class MemberChatService {
    private readonly logger = new Logger(MemberChatService.name)

    constructor(
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        @InjectRepository(GroupChatMember)
        private readonly memberRepo: Repository<GroupChatMember>,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly providers: PlatformProviderService,
        private readonly messages: AgentMessageHistoryService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger
    ) {}

    async chat(params: MemberChatParams): Promise<MemberChatResult> {
        const { group, userId, runId, agent, instruction } = params
        const session = await this.prepareMemberSession(group, params.member, agent)
        const prompt = this.buildPrompt(instruction)
        this.debug.log('group.member_chat.instruction', {
            groupId: group.id,
            runId,
            agent: {
                agentId: agent.id,
                name: agent.name,
                vendor: agent.vendor,
                model: agent.model,
                roleInGroup: params.member.roleInGroup
            },
            session: {
                id: session.id,
                workingDirectory: session.workingDirectory,
                sessionHomeDirectory: session.sessionHomeDirectory,
                sdkSessionId: session.sdkSessionId
            },
            prompt
        })

        let finalText = ''
        let fatal: string | null = null
        let agentMessageId: string | null = null
        try {
            const result = await this.runMemberChatTurn(params, session, agent, prompt)
            finalText = result.finalText
            fatal = result.fatal
            agentMessageId = result.agentMessageId
        } catch (err) {
            fatal = this.errMsg(err)
        }

        const summary = finalText.trim() || '(无输出)'
        if (!fatal && finalText.trim()) {
            await this.groupMessages.appendText(
                group.id,
                userId,
                'agent',
                finalText,
                agent.id,
                null,
                agentMessageId
            )
        }
        const result = { success: !fatal, summary: fatal ? `失败：${fatal}` : summary }
        this.debug.log('group.member_chat.finished', {
            groupId: group.id,
            runId,
            agentId: agent.id,
            fatal,
            finalText,
            result
        })
        return result
    }

    private buildPrompt(instruction: string): string {
        return [
            '这是群聊中的轻量回复，不是任务交付。',
            '非必要情况下不要使用工具、不要读取或修改文件、不要创建计划或待办。',
            '但如果需要读取文件确认细节/信息等场景，请忽略以上限制，可以使用各种工具获取你所需要的信息。',
            '只用你自己的角色身份，直接给出一条符合用户提问/编排器（Orchestrator）指令的回复。',
            `用户/编排器的指令：${instruction}`
        ].join('\n')
    }

    private async runMemberChatTurn(
        params: MemberChatParams,
        session: AgentSession,
        agent: Agent,
        prompt: string
    ): Promise<{ finalText: string; fatal: string | null; agentMessageId: string | null }> {
        const provider = await this.resolveProvider(params.userId, agent)
        const config = agentToConfig(agent, session, provider.apiKey, provider.baseUrl, session.id)
        config.allowedTools = []
        config.skills = []
        config.mcpServers = undefined
        config.permissionMode = 'plan'
        const adapter = createAgent(agent.vendor, config)

        this.debug.log('group.member_chat.turn_started', {
            groupId: params.group.id,
            runId: params.runId,
            agentId: agent.id,
            vendor: agent.vendor,
            model: agent.model,
            workingDirectory: session.workingDirectory,
            prompt
        })

        const stepDrafts: StepDraft[] = []
        const toolIndex = new Map<string, number>()
        const textParts: string[] = []
        let finalFromDone: string | null = null
        let structuredText: string | null = null
        let fatal: string | null = null

        let timeout: NodeJS.Timeout | null = null
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeout = setTimeout(
                () => reject(new Error('member chat turn timed out')),
                LIGHTWEIGHT_CHAT_TIMEOUT_MS
            )
            timeout.unref?.()
        })

        await this.messages.saveMessage(params.userId, agent.id, session.id, 'user', prompt)
        try {
            const iterator = adapter
                .send(prompt, {
                    signal: params.signal,
                    outputSchema: LIGHTWEIGHT_CHAT_SCHEMA
                })
                [Symbol.asyncIterator]()
            while (true) {
                const next = await Promise.race([iterator.next(), timeoutPromise])
                if (next.done) break
                const ev = next.value
                const normalized = normalizeMemberChatStreamEvent(ev)
                if (ev.type === 'done') {
                    const displayText = displayTextFrom(ev.finalText, ev.structuredOutput)
                    if (displayText) finalFromDone = displayText
                    const parsed = parseStructuredText(ev.structuredOutput)
                    if (parsed) structuredText = parsed
                    await this.publishMemberEvent(params, normalized)
                    continue
                }
                if (ev.type === 'turn_completed') {
                    const displayText = displayTextFrom(ev.finalText, ev.structuredOutput)
                    if (displayText) finalFromDone = displayText
                    const parsed = parseStructuredText(ev.structuredOutput)
                    if (parsed) structuredText = parsed
                }
                if (normalized.type === 'text') textParts.push(normalized.text)
                else if (ev.type === 'error' && ev.fatal) fatal = ev.message
                else this.messages.collectStep(ev, stepDrafts, toolIndex)
                this.debug.log('group.member_chat.turn_event', {
                    groupId: params.group.id,
                    runId: params.runId,
                    agentId: agent.id,
                    event: ev
                })
                await this.publishMemberEvent(params, normalized)
            }
        } catch (err) {
            fatal ??= this.errMsg(err)
        } finally {
            if (timeout) clearTimeout(timeout)
        }

        const rawFinalText = finalFromDone ?? textParts.join('')
        const finalText = (
            structuredText ??
            parseJsonTextField(rawFinalText) ??
            rawFinalText
        ).trim()
        let agentMessageId: string | null = null
        this.debug.log('group.member_chat.turn_finished', {
            groupId: params.group.id,
            runId: params.runId,
            agentId: agent.id,
            fatal,
            finalText,
            stepCount: stepDrafts.length
        })

        try {
            if (finalText) {
                const msg = await this.messages.saveMessage(
                    params.userId,
                    agent.id,
                    session.id,
                    'agent',
                    finalText
                )
                if (msg) {
                    agentMessageId = msg.id
                    await this.messages.saveSteps(msg.id, session.id, stepDrafts)
                }
            }
            session.sdkSessionId = adapter.sessionId ?? session.sdkSessionId
            session.status = 'active'
            session.lastTurnAt = new Date()
            await this.sessionRepo.save(session)
        } catch (err) {
            this.logger.error(`Failed to persist member chat turn: ${this.errMsg(err)}`)
        }

        return { finalText, fatal, agentMessageId }
    }

    private async publishMemberEvent(params: MemberChatParams, ev: AgentEvent): Promise<void> {
        await this.runStream
            .publish(params.runId, {
                type: 'member_turn_event',
                runId: params.runId,
                taskId: null,
                agentId: params.agent.id,
                event: ev
            })
            .catch(() => undefined)
    }

    private async prepareMemberSession(
        group: GroupChat,
        member: GroupChatMember,
        agent: Agent
    ): Promise<AgentSession> {
        const workingDirectory = resolve(this.workspace.repoDir(group.id, group.workspaceDir))
        const home = resolve(this.workspace.memberHomeDir(group.id, agent.id, group.workspaceDir))
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
                scope: 'group',
                title: null,
                workingDirectory,
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
            this.debug.log('group.member_chat.session_created', {
                groupId: group.id,
                agentId: agent.id,
                sessionId: session.id,
                workingDirectory,
                home
            })
        }
        session.scope = 'group'
        session.workingDirectory = workingDirectory
        session.sessionHomeDirectory = home
        await this.sessionRepo.save(session)

        await this.agentWorkspace.ensureAgentHomeDirectory(agent.vendor, agent.agentHomeDirectory)
        await this.agentWorkspace.ensureChatRuntimeDirectories(agent.vendor, workingDirectory, home)
        await this.agentWorkspace.syncVendorConfigToWorkingDirectory(
            agent.vendor,
            agent.agentHomeDirectory,
            workingDirectory
        )
        this.debug.log('group.member_chat.session_prepared', {
            groupId: group.id,
            agentId: agent.id,
            sessionId: session.id,
            workingDirectory,
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

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
