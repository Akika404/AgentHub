import { Injectable } from '@nestjs/common'
import type { AgentEvent } from './adapter/index.js'
import type {
    MessageReplyRef,
    WorkspaceCommitPayload,
    WorkspaceCommitResult,
    WorkspaceDiffSummary
} from '@agenthub/shared'
import { AgentConfigService } from './agents/agent-config.service.js'
import { AgentChatService } from './chats/agent-chat.service.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import { UpdateAgentDto } from './dto/update-agent.dto.js'
import { CreateAgentChatDto } from './dto/create-agent-chat.dto.js'
import { UpdateAgentChatDto } from './dto/update-agent-chat.dto.js'
import type { AgentView } from './dto/agent-view.dto.js'
import type { AgentChatView } from './dto/agent-chat-view.dto.js'
import type { AgentChatMessageView } from './dto/agent-message-view.dto.js'

/**
 * AgentManager is the public facade used by controllers.
 *
 * The module keeps this stable entry point while the actual responsibilities live in
 * focused services: AgentConfigService, AgentChatService, AgentRuntimeService,
 * AgentWorkspaceService, and AgentMessageHistoryService.
 */
@Injectable()
export class AgentManager {
    constructor(
        private readonly agents: AgentConfigService,
        private readonly chats: AgentChatService
    ) {}

    createAgent(userId: string, dto: CreateAgentDto): Promise<AgentView> {
        return this.agents.createAgent(userId, dto)
    }

    list(userId: string): Promise<AgentView[]> {
        return this.agents.list(userId)
    }

    get(userId: string, agentId: string): Promise<AgentView> {
        return this.agents.get(userId, agentId)
    }

    updateAgent(userId: string, agentId: string, dto: UpdateAgentDto): Promise<AgentView> {
        return this.agents.updateAgent(userId, agentId, dto)
    }

    remove(userId: string, agentId: string): Promise<{ deleted: true }> {
        return this.agents.remove(userId, agentId)
    }

    createChat(userId: string, dto: CreateAgentChatDto): Promise<AgentChatView> {
        return this.chats.createChat(userId, dto)
    }

    listChats(userId: string): Promise<AgentChatView[]> {
        return this.chats.listChats(userId)
    }

    getChat(userId: string, chatId: string): Promise<AgentChatView> {
        return this.chats.getChat(userId, chatId)
    }

    updateChat(userId: string, chatId: string, dto: UpdateAgentChatDto): Promise<AgentChatView> {
        return this.chats.updateChat(userId, chatId, dto)
    }

    listChatMessages(userId: string, chatId: string): Promise<AgentChatMessageView[]> {
        return this.chats.listChatMessages(userId, chatId)
    }

    getWorkspaceDiff(userId: string, chatId: string): Promise<WorkspaceDiffSummary> {
        return this.chats.getWorkspaceDiff(userId, chatId)
    }

    commitWorkspace(
        userId: string,
        chatId: string,
        payload: WorkspaceCommitPayload
    ): Promise<WorkspaceCommitResult> {
        return this.chats.commitWorkspace(userId, chatId, payload)
    }

    startTurn(
        userId: string,
        chatId: string,
        prompt: string,
        replyTo: MessageReplyRef | null = null
    ): Promise<{ turnId: string }> {
        return this.chats.startTurn(userId, chatId, prompt, replyTo)
    }

    subscribeTurn(
        userId: string,
        chatId: string,
        turnId: string
    ): Promise<AsyncIterable<AgentEvent>> {
        return this.chats.subscribeTurn(userId, chatId, turnId)
    }

    abortTurn(userId: string, chatId: string, turnId: string): Promise<{ aborted: true }> {
        return this.chats.abortTurn(userId, chatId, turnId)
    }

    clearChat(userId: string, chatId: string): Promise<AgentChatView> {
        return this.chats.clearChat(userId, chatId)
    }

    removeChat(userId: string, chatId: string): Promise<{ deleted: true }> {
        return this.chats.removeChat(userId, chatId)
    }
}
