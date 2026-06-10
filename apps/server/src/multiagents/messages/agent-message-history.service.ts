import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type {
    MessageReplyRef,
    UpdateAgentChatMessagePayload,
    BlackboardArtifact,
    DeployManifest
} from '@agenthub/shared'
import type { AgentEvent, AgentTodoItem, ToolCallStatus } from '../adapter/index.js'
import type { AgentChatMessageView } from '../dto/agent-message-view.dto.js'
import { AgentMessage } from '../entities/agent-message.entity.js'
import { AgentMessageStep } from '../entities/agent-message-step.entity.js'
import { toAgentChatMessageView } from '../mappers/agent-message.mapper.js'
import { BusinessException } from '../../common/index.js'
import {
    renderPinnedMessagesContext,
    type PinnedMessageContextItem
} from '../context/pinned-message-context.js'

export interface StepDraft {
    type: AgentMessageStep['type']
    text?: string
    toolName?: string
    toolUseId?: string
    toolStatus?: ToolCallStatus
    input?: unknown
    output?: unknown
    isError?: boolean
    todos?: AgentTodoItem[]
}

export interface RegeneratePromptSource {
    prompt: string
    replyTo: MessageReplyRef | null
    sourceMessageId: string
}

@Injectable()
export class AgentMessageHistoryService {
    constructor(
        @InjectRepository(AgentMessage)
        private readonly messageRepo: Repository<AgentMessage>,
        @InjectRepository(AgentMessageStep)
        private readonly stepRepo: Repository<AgentMessageStep>
    ) {}

    async listChatMessages(userId: string, sessionId: string): Promise<AgentChatMessageView[]> {
        const messages = await this.messageRepo.find({
            where: { userId, sessionId },
            order: { createdAt: 'ASC', id: 'ASC' }
        })
        const steps = await this.stepRepo.find({
            where: { sessionId },
            order: { seq: 'ASC' }
        })
        const stepsByMessage = new Map<string, AgentMessageStep[]>()
        for (const step of steps) {
            const list = stepsByMessage.get(step.messageId)
            if (list) list.push(step)
            else stepsByMessage.set(step.messageId, [step])
        }
        return messages.map((message) =>
            toAgentChatMessageView(message, stepsByMessage.get(message.id) ?? [])
        )
    }

    async saveMessage(
        userId: string,
        agentId: string,
        sessionId: string,
        role: AgentMessage['role'],
        text: string,
        replyTo: MessageReplyRef | null = null,
        extra: { artifacts?: BlackboardArtifact[]; deployManifest?: DeployManifest | null } = {}
    ): Promise<AgentMessage | null> {
        const trimmed = text.trim()
        if (!trimmed) return null
        return this.messageRepo.save(
            this.messageRepo.create({
                userId,
                agentId,
                sessionId,
                role,
                text: trimmed,
                replyTo,
                pinned: false,
                artifacts: extra.artifacts && extra.artifacts.length > 0 ? extra.artifacts : null,
                deployManifest: extra.deployManifest ?? null
            })
        )
    }

    async updateChatMessage(
        userId: string,
        sessionId: string,
        messageId: string,
        payload: UpdateAgentChatMessagePayload
    ): Promise<AgentChatMessageView> {
        const message = await this.messageRepo.findOne({
            where: { id: messageId, userId, sessionId }
        })
        if (!message) throw BusinessException.notFound(`Message ${messageId} not found`)

        if (payload.pinned !== undefined) message.pinned = payload.pinned
        const saved = await this.messageRepo.save(message)
        const steps = await this.stepRepo.find({
            where: { messageId: saved.id, sessionId },
            order: { seq: 'ASC' }
        })
        return toAgentChatMessageView(saved, steps)
    }

    async pinnedContext(userId: string, sessionId: string): Promise<string> {
        const items = await this.listPinnedContextItems(userId, sessionId)
        return renderPinnedMessagesContext('Pinned messages (会话内全局上下文)', items)
    }

    /**
     * 取本会话内某条消息的纯文本（引用注入用，按 id + userId + sessionId 归属校验）。
     * 取不到（含跨会话/未持久化的 client 临时 id）返回 null，由调用方回退 client excerpt。
     */
    async getMessageText(
        userId: string,
        sessionId: string,
        messageId: string
    ): Promise<string | null> {
        const row = await this.messageRepo.findOne({
            where: { id: messageId, userId, sessionId }
        })
        return row?.text ?? null
    }

    async resolveRegeneratePrompt(
        userId: string,
        sessionId: string,
        messageId: string
    ): Promise<RegeneratePromptSource> {
        const rows = await this.messageRepo.find({
            where: { userId, sessionId },
            order: { createdAt: 'ASC', id: 'ASC' }
        })
        const targetIndex = rows.findIndex((row) => row.id === messageId)
        if (targetIndex === -1) throw BusinessException.notFound(`Message ${messageId} not found`)

        const target = rows[targetIndex]
        const source =
            target.role === 'user'
                ? target
                : rows
                      .slice(0, targetIndex)
                      .reverse()
                      .find((row) => row.role === 'user')

        if (!source) {
            throw BusinessException.badRequest('没有可用于重新生成的用户消息')
        }

        return {
            prompt: source.text,
            replyTo: source.replyTo,
            sourceMessageId: source.id
        }
    }

    private async listPinnedContextItems(
        userId: string,
        sessionId: string
    ): Promise<PinnedMessageContextItem[]> {
        const rows = await this.messageRepo.find({
            where: { userId, sessionId, pinned: true },
            order: { createdAt: 'ASC', id: 'ASC' }
        })
        return rows.map((row) => ({
            sender: this.senderLabel(row.role),
            kind: row.role,
            text: row.text,
            createdAt: row.createdAt
        }))
    }

    private senderLabel(role: AgentMessage['role']): string {
        if (role === 'user') return '用户'
        if (role === 'agent') return 'Agent'
        return '系统'
    }

    async saveSteps(messageId: string, sessionId: string, drafts: StepDraft[]): Promise<void> {
        if (drafts.length === 0) return
        const entities = drafts.map((draft, seq) =>
            this.stepRepo.create({
                messageId,
                sessionId,
                seq,
                type: draft.type,
                text: draft.text ?? null,
                toolName: draft.toolName ?? null,
                toolUseId: draft.toolUseId ?? null,
                toolStatus: draft.toolStatus ?? null,
                input: draft.input,
                output: draft.output,
                isError: draft.isError ?? null,
                todos: draft.todos ?? null
            })
        )
        await this.stepRepo.save(entities)
    }

    collectStep(ev: AgentEvent, drafts: StepDraft[], toolIndexById: Map<string, number>): void {
        switch (ev.type) {
            case 'thinking':
                drafts.push({ type: 'thinking', text: ev.text })
                return
            case 'progress':
                drafts.push({ type: 'progress', text: ev.text })
                return
            case 'tool_use': {
                const existing = toolIndexById.get(ev.id)
                if (existing !== undefined) {
                    drafts[existing].toolStatus = ev.status
                    drafts[existing].input = ev.input
                    return
                }
                toolIndexById.set(ev.id, drafts.length)
                drafts.push({
                    type: 'tool',
                    toolName: ev.name,
                    toolUseId: ev.id,
                    toolStatus: ev.status,
                    input: ev.input
                })
                return
            }
            case 'tool_result': {
                const idx = toolIndexById.get(ev.toolUseId)
                const isError = Boolean(ev.isError)
                if (idx !== undefined) {
                    const draft = drafts[idx]
                    draft.output = ev.output
                    draft.isError = isError
                    if (draft.toolStatus === 'started') {
                        draft.toolStatus = isError ? 'failed' : 'completed'
                    }
                    return
                }
                drafts.push({
                    type: 'tool',
                    toolUseId: ev.toolUseId,
                    toolStatus: isError ? 'failed' : 'completed',
                    output: ev.output,
                    isError
                })
                return
            }
            case 'todo': {
                const existing = drafts.find((d) => d.type === 'todo')
                if (existing) existing.todos = ev.items
                else drafts.push({ type: 'todo', todos: ev.items })
                return
            }
            case 'plan': {
                const existing = drafts.find((d) => d.type === 'plan')
                if (existing) existing.text = ev.plan
                else drafts.push({ type: 'plan', text: ev.plan })
                return
            }
            default:
                return
        }
    }

    async deleteChatHistory(userId: string, sessionId: string): Promise<void> {
        await this.stepRepo.delete({ sessionId })
        await this.messageRepo.delete({ userId, sessionId })
    }
}
