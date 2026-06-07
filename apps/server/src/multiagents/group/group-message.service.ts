import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { AgentQuestion, GroupMessageView, GroupSenderRole, TaskItem } from '@agenthub/shared'
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
        private readonly messageRepo: Repository<GroupMessage>
    ) {}

    async listMessages(groupId: string): Promise<GroupMessageView[]> {
        const rows = await this.messageRepo.find({
            where: { groupChatId: groupId },
            order: { createdAt: 'ASC' }
        })
        return rows.map(toGroupMessageView)
    }

    async appendText(
        groupId: string,
        userId: string,
        senderRole: GroupSenderRole,
        text: string,
        senderAgentId: string | null = null
    ): Promise<GroupMessageView> {
        const saved = await this.messageRepo.save(
            this.messageRepo.create({
                groupChatId: groupId,
                userId,
                kind: 'text',
                senderRole,
                senderAgentId,
                text,
                payload: null
            })
        )
        return toGroupMessageView(saved)
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
}
