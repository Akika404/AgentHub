import type { AgentMessageRole } from '../entities/agent-message.entity.js'
import type { AgentMessageStepType } from '../entities/agent-message-step.entity.js'
import type { AgentTodoItem, ToolCallStatus } from '../adapter/index.js'
import type { MessageReplyRef } from '@agenthub/shared'

/** 一条运行步骤的对外视图。tool 步骤同时带 input 与 output */
export interface AgentRunStepView {
    id: string
    seq: number
    type: AgentMessageStepType
    /** thinking/progress 文本；其余类型为 null */
    text: string | null
    toolName: string | null
    toolUseId: string | null
    toolStatus: ToolCallStatus | null
    input: unknown
    output: unknown
    isError: boolean | null
    todos: AgentTodoItem[] | null
}

export interface AgentChatMessageView {
    id: string
    chatId: string
    agentId: string
    role: AgentMessageRole
    text: string
    createdAt: string
    /** 该消息是否被 Pin；Pin 后会注入当前会话后续上下文 */
    pinned: boolean
    /** 该消息产出过程中的有序运行步骤；仅 agent 消息可能非空 */
    steps?: AgentRunStepView[]
    /** 当本条 user 消息为引用回复时携带被引用消息快照 */
    replyTo?: MessageReplyRef
}
