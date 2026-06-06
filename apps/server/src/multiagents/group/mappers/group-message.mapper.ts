import type {
    GroupMessageView,
    OptionItem,
    TaskItem
} from '@agenthub/shared'
import type { GroupMessage } from '../entities/group-message.entity.js'

/** GroupMessage 实体 -> GroupMessageView（按 kind 还原结构化负载） */
export function toGroupMessageView(message: GroupMessage): GroupMessageView {
    const base = {
        id: message.id,
        groupChatId: message.groupChatId,
        senderRole: message.senderRole,
        senderAgentId: message.senderAgentId,
        createdAt: message.createdAt.toISOString()
    }
    const payload = message.payload ?? {}
    switch (message.kind) {
        case 'task-list':
            return {
                ...base,
                kind: 'task-list',
                heading: typeof payload.heading === 'string' ? payload.heading : '',
                tasks: Array.isArray(payload.tasks) ? (payload.tasks as TaskItem[]) : []
            }
        case 'options':
            return {
                ...base,
                kind: 'options',
                text: message.text ?? '',
                options: Array.isArray(payload.options) ? (payload.options as OptionItem[]) : [],
                answered: typeof payload.answered === 'boolean' ? payload.answered : undefined,
                answeredOptionId:
                    typeof payload.answeredOptionId === 'string'
                        ? payload.answeredOptionId
                        : undefined
            }
        case 'system':
            return { ...base, kind: 'system', text: message.text ?? '' }
        case 'text':
        default:
            return { ...base, kind: 'text', text: message.text ?? '' }
    }
}
