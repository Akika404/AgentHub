import type {
    AgentQuestion,
    AgentRunStepView,
    BlackboardArtifact,
    DeployManifest,
    GroupMessageView,
    MessageReplyRef,
    OptionItem,
    TaskItem
} from '@agenthub/shared'
import type { GroupMessage } from '../entities/group-message.entity.js'

/** 校验引用快照字段齐全（防御脏数据），不全则视为无引用 */
function toReplyRef(ref: MessageReplyRef | null): MessageReplyRef | undefined {
    if (!ref || typeof ref !== 'object') return undefined
    const { messageId, senderName, excerpt } = ref
    if (
        typeof messageId !== 'string' ||
        typeof senderName !== 'string' ||
        typeof excerpt !== 'string'
    ) {
        return undefined
    }
    return { messageId, senderName, excerpt }
}

/** GroupMessage 实体 -> GroupMessageView（按 kind 还原结构化负载） */
export function toGroupMessageView(
    message: GroupMessage,
    steps: AgentRunStepView[] = []
): GroupMessageView {
    const base = {
        id: message.id,
        groupChatId: message.groupChatId,
        senderRole: message.senderRole,
        senderAgentId: message.senderAgentId,
        createdAt: message.createdAt.toISOString(),
        pinned: message.pinned === true
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
        case 'agent-question':
            return {
                ...base,
                kind: 'agent-question',
                taskId: typeof payload.taskId === 'string' ? payload.taskId : '',
                questions: Array.isArray(payload.questions)
                    ? (payload.questions as AgentQuestion[])
                    : [],
                summary: message.text ?? '',
                answered: typeof payload.answered === 'boolean' ? payload.answered : undefined,
                answerText: typeof payload.answerText === 'string' ? payload.answerText : undefined
            }
        case 'system':
            return { ...base, kind: 'system', text: message.text ?? '' }
        case 'deploy':
            return {
                ...base,
                kind: 'deploy',
                manifest: (payload.manifest ?? { mode: 'static' }) as DeployManifest,
                artifacts: Array.isArray(payload.artifacts)
                    ? (payload.artifacts as BlackboardArtifact[])
                    : []
            }
        case 'text':
        default: {
            const replyTo = toReplyRef(message.replyTo)
            return {
                ...base,
                kind: 'text',
                text: message.text ?? '',
                ...(steps.length > 0 ? { steps } : {}),
                ...(replyTo ? { replyTo } : {})
            }
        }
    }
}
