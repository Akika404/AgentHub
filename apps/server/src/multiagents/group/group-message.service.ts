import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import type {
    AgentQuestion,
    BlackboardArtifact,
    DeployManifest,
    GroupMessageView,
    GroupSenderRole,
    MessageReplyRef,
    TaskItem
} from '@agenthub/shared'
import { AgentMessageStep } from '../entities/agent-message-step.entity.js'
import { toAgentRunStepView } from '../mappers/agent-message.mapper.js'
import { GroupMessage } from './entities/group-message.entity.js'
import { toGroupMessageView } from './mappers/group-message.mapper.js'

/**
 * GroupMessageService — 展示层 presentation_log 的读写（多发言者）。
 *
 * 给人看 / 审计；与"给 Agent 的结构化上下文"解耦，群聊原文默认不注入 Agent。
 */
@Injectable()
export class GroupMessageService {
    constructor(
        @InjectRepository(GroupMessage)
        private readonly messageRepo: Repository<GroupMessage>,
        @InjectRepository(AgentMessageStep)
        private readonly stepRepo: Repository<AgentMessageStep>
    ) {}

    async listMessages(groupId: string): Promise<GroupMessageView[]> {
        const rows = await this.messageRepo.find({
            where: { groupChatId: groupId },
            order: { createdAt: 'ASC' }
        })
        const stepsByMessage = await this.loadStepsByAgentMessage(rows)
        return rows.map((row) => {
            const agentMessageId = this.agentMessageIdFromPayload(row.payload)
            const steps = agentMessageId ? (stepsByMessage.get(agentMessageId) ?? []) : []
            return toGroupMessageView(row, steps.map(toAgentRunStepView))
        })
    }

    async appendText(
        groupId: string,
        userId: string,
        senderRole: GroupSenderRole,
        text: string,
        senderAgentId: string | null = null,
        replyTo: MessageReplyRef | null = null,
        agentMessageId: string | null = null
    ): Promise<GroupMessageView> {
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'text',
                senderRole,
                senderAgentId,
                text,
                payload: agentMessageId ? { agentMessageId } : null,
                replyTo
            })
        )
        return toGroupMessageView(saved)
    }

    /**
     * 取某条展示层消息的纯文本原文（引用注入用，按 messageId + groupId 归属校验）。
     * 仅 text/system/options 有正文；其它卡片返回 null，由调用方回退到 client 摘录。
     */
    async getMessageText(groupId: string, messageId: string): Promise<string | null> {
        const row = await this.messageRepo.findOne({
            where: { id: messageId, groupChatId: groupId }
        })
        return row?.text ?? null
    }

    async appendSystem(groupId: string, userId: string, text: string): Promise<GroupMessageView> {
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'system',
                senderRole: 'system',
                senderAgentId: null,
                text,
                payload: null
            })
        )
        return toGroupMessageView(saved)
    }

    async appendTaskList(
        groupId: string,
        userId: string,
        senderRole: GroupSenderRole,
        heading: string,
        tasks: TaskItem[],
        senderAgentId: string | null = null
    ): Promise<GroupMessageView> {
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'task-list',
                senderRole,
                senderAgentId,
                text: null,
                payload: { heading, tasks }
            })
        )
        return toGroupMessageView(saved)
    }

    /**
     * 成员挂起任务向用户提问 → 落一张 agent-question 卡片。
     * 在此归一化 question/option 的 id（q1/q2…、q1-o1…），成员不必自行给 id。
     * text 存一句话摘要（预览/回退用）；结构化问题放 payload。
     */
    async appendAgentQuestion(
        groupId: string,
        userId: string,
        senderAgentId: string,
        taskId: string,
        questions: AgentQuestion[],
        summary: string
    ): Promise<GroupMessageView> {
        const normalized = questions.map((q, qi) => ({
            id: `q${qi + 1}`,
            question: q.question,
            ...(q.header ? { header: q.header } : {}),
            multiSelect: q.multiSelect === true,
            allowText: q.allowText === true,
            options: (q.options ?? []).map((o, oi) => ({
                id: `q${qi + 1}-o${oi + 1}`,
                label: o.label,
                ...(o.description ? { description: o.description } : {})
            }))
        }))
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'agent-question',
                senderRole: 'agent',
                senderAgentId,
                text: summary,
                payload: { taskId, questions: normalized, answered: false }
            })
        )
        return toGroupMessageView(saved)
    }

    /**
     * 群聊 run 在 Orchestrator 总结后产出可呈现交付物 → 落一张 deploy 卡片。
     * manifest 描述如何呈现/运行；artifacts 是卡片可点的产物列表。senderRole 固定
     * 为 orchestrator（由编排器在 run 收尾时发出）。
     */
    async appendDeploy(
        groupId: string,
        userId: string,
        manifest: DeployManifest,
        artifacts: BlackboardArtifact[]
    ): Promise<GroupMessageView> {
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'deploy',
                senderRole: 'orchestrator',
                senderAgentId: null,
                text: null,
                payload: { manifest, artifacts }
            })
        )
        return toGroupMessageView(saved)
    }

    /** 用户回复恢复挂起任务时，把对应 agent-question 卡片标记为已作答（刷新后置灰）。 */
    async markAgentQuestionAnswered(
        groupId: string,
        taskId: string,
        answerText: string
    ): Promise<number> {
        const messages = await this.messageRepo.find({
            where: { groupChatId: groupId, kind: 'agent-question' }
        })
        let updated = 0
        for (const message of messages) {
            const payload = message.payload ?? {}
            if (payload.taskId !== taskId || payload.answered === true) continue
            message.payload = { ...payload, answered: true, answerText }
            await this.messageRepo.save(message)
            updated += 1
        }
        return updated
    }

    async updateTaskListTaskStatus(
        groupId: string,
        taskId: string,
        status: TaskItem['status']
    ): Promise<number> {
        const messages = await this.messageRepo.find({
            where: { groupChatId: groupId, kind: 'task-list' }
        })
        let updated = 0
        for (const message of messages) {
            const payload = message.payload ?? {}
            if (!Array.isArray(payload.tasks)) continue
            let changed = false
            const tasks = payload.tasks.map((item) => {
                if (!this.isTaskItem(item) || item.id !== taskId) return item
                changed = changed || item.status !== status
                return { ...item, status }
            })
            if (!changed) continue
            message.payload = { ...payload, tasks }
            await this.messageRepo.save(message)
            updated += 1
        }
        return updated
    }

    private isTaskItem(value: unknown): value is TaskItem {
        if (typeof value !== 'object' || value === null) return false
        const rec = value as Record<string, unknown>
        return typeof rec.id === 'string' && typeof rec.title === 'string'
    }

    private async loadStepsByAgentMessage(
        messages: GroupMessage[]
    ): Promise<Map<string, AgentMessageStep[]>> {
        const agentMessageIds = [
            ...new Set(
                messages
                    .map((message) => this.agentMessageIdFromPayload(message.payload))
                    .filter((id): id is string => id !== null)
            )
        ]
        const stepsByMessage = new Map<string, AgentMessageStep[]>()
        if (agentMessageIds.length === 0) return stepsByMessage

        const steps = await this.stepRepo.find({
            where: { messageId: In(agentMessageIds) },
            order: { messageId: 'ASC', seq: 'ASC' }
        })
        for (const step of steps) {
            const list = stepsByMessage.get(step.messageId)
            if (list) list.push(step)
            else stepsByMessage.set(step.messageId, [step])
        }
        return stepsByMessage
    }

    private agentMessageIdFromPayload(payload: Record<string, unknown> | null): string | null {
        const value = payload?.agentMessageId
        return typeof value === 'string' && value.length > 0 ? value : null
    }
}
