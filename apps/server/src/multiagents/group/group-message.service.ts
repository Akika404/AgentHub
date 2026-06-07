import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import type { GroupMessageView, GroupSenderRole, TaskItem } from '@agenthub/shared'
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
