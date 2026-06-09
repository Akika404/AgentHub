import {
    Body,
    Controller,
    Delete,
    Get,
    MessageEvent,
    Param,
    Patch,
    Post,
    Sse,
    UseGuards
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import { Observable, from, map } from 'rxjs'
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator.js'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../user/auth/current-user.decorator.js'
import type { User } from '../user/entities/user.entity.js'
import { AgentManager } from './agent-manager.service.js'
import { CreateAgentChatDto } from './dto/create-agent-chat.dto.js'
import { UpdateAgentChatDto } from './dto/update-agent-chat.dto.js'
import { ConverseDto } from './dto/converse.dto.js'
import type { AgentChatView } from './dto/agent-chat-view.dto.js'
import { AgentChatViewDto, DeleteAgentChatResultDto } from './dto/agent-chat-response.dto.js'
import { StartTurnResultDto, AbortTurnResultDto } from './dto/turn-response.dto.js'
import type { AgentChatMessageView } from './dto/agent-message-view.dto.js'
import { AgentChatMessageViewDto } from './dto/agent-message-response.dto.js'
import { WorkspaceCommitDto } from './dto/workspace-commit.dto.js'
import {
    WorkspaceCommitResultDto,
    WorkspaceDiffSummaryDto
} from './dto/workspace-diff-response.dto.js'
import type { WorkspaceCommitResult, WorkspaceDiffSummary } from '@agenthub/shared'

@ApiTags('agent-chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agent-chats')
export class AgentChatsController {
    constructor(private readonly manager: AgentManager) {}

    @Post()
    @ApiOperation({
        summary: '创建单 Agent 聊天',
        description:
            '选择一个已有 Agent 创建独立聊天会话。workingDirectory 可选；未提供时分配到当前用户 agent_workspace/chat-<sessionId>。systemPrompt 继承 Agent 配置。'
    })
    @ApiEnvelope(AgentChatViewDto, { status: 201 })
    create(@CurrentUser() user: User, @Body() dto: CreateAgentChatDto): Promise<AgentChatView> {
        return this.manager.createChat(user.id, dto)
    }

    @Get()
    @ApiOperation({ summary: '列出当前用户的全部单 Agent 聊天' })
    @ApiEnvelope(AgentChatViewDto, { isArray: true })
    list(@CurrentUser() user: User): Promise<AgentChatView[]> {
        return this.manager.listChats(user.id)
    }

    @Get(':chatId')
    @ApiOperation({ summary: '查询单个单 Agent 聊天' })
    @ApiEnvelope(AgentChatViewDto)
    get(@CurrentUser() user: User, @Param('chatId') chatId: string): Promise<AgentChatView> {
        return this.manager.getChat(user.id, chatId)
    }

    @Patch(':chatId')
    @ApiOperation({ summary: '修改单 Agent 聊天列表状态（置顶 / 归档）' })
    @ApiEnvelope(AgentChatViewDto)
    update(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Body() dto: UpdateAgentChatDto
    ): Promise<AgentChatView> {
        return this.manager.updateChat(user.id, chatId, dto)
    }

    @Get(':chatId/messages')
    @ApiOperation({ summary: '查询单 Agent 聊天消息历史' })
    @ApiEnvelope(AgentChatMessageViewDto, { isArray: true })
    listMessages(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string
    ): Promise<AgentChatMessageView[]> {
        return this.manager.listChatMessages(user.id, chatId)
    }

    @Get(':chatId/workspace-diff')
    @ApiOperation({ summary: '获取单 Agent 聊天工作区当前未提交变更' })
    @ApiEnvelope(WorkspaceDiffSummaryDto)
    workspaceDiff(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string
    ): Promise<WorkspaceDiffSummary> {
        return this.manager.getWorkspaceDiff(user.id, chatId)
    }

    @Post(':chatId/workspace-commit')
    @ApiOperation({
        summary: '提交单 Agent 聊天工作区当前未提交变更',
        description: '会话运行中会拒绝提交，避免把 Agent 正在写入的中间状态提交进 git。'
    })
    @ApiEnvelope(WorkspaceCommitResultDto, { status: 201 })
    workspaceCommit(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Body() dto: WorkspaceCommitDto
    ): Promise<WorkspaceCommitResult> {
        return this.manager.commitWorkspace(user.id, chatId, dto)
    }

    @Post(':chatId/converse')
    @ApiOperation({
        summary: '启动一轮对话（后台游离运行）',
        description:
            '在服务端启动一轮对话并立即返回 turnId。该轮与本请求生命周期解耦，发起端断连不会中止它；通过 GET :chatId/turns/:turnId/events 订阅其进度（可多端同时订阅）。若该聊天已有进行中的轮，新 prompt 会返回 busy；观看既存轮请使用 activeTurnId 订阅事件流。'
    })
    @ApiEnvelope(StartTurnResultDto, { status: 201 })
    startTurn(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Body() dto: ConverseDto
    ): Promise<{ turnId: string }> {
        return this.manager.startTurn(user.id, chatId, dto.prompt, dto.replyTo ?? null)
    }

    @Sse(':chatId/turns/:turnId/events')
    @SkipEnvelope()
    @ApiOperation({
        summary: '订阅某一轮对话的事件流（SSE，回放 + 实时追尾）',
        description:
            '返回 text/event-stream，先回放该轮已发生的全部 AgentEvent，再实时追尾，遇 done 结束。断开本连接不会中止该轮（后台继续运行）；可被多端同时订阅以实时围观。'
    })
    @ApiProduces('text/event-stream')
    async converseEvents(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Param('turnId') turnId: string
    ): Promise<Observable<MessageEvent>> {
        const stream = await this.manager.subscribeTurn(user.id, chatId, turnId)
        return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
    }

    @Post(':chatId/turns/:turnId/abort')
    @ApiOperation({
        summary: '中止某一轮对话',
        description: '主动停止一个正在运行的 turn；跨实例广播，已产出的内容仍会落库。'
    })
    @ApiEnvelope(AbortTurnResultDto, { status: 201 })
    abortTurn(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Param('turnId') turnId: string
    ): Promise<{ aborted: true }> {
        return this.manager.abortTurn(user.id, chatId, turnId)
    }

    @Post(':chatId/clear')
    @ApiOperation({ summary: '清空单 Agent 聊天', description: '丢弃底层句柄并清空 UI 消息历史' })
    @ApiEnvelope(AgentChatViewDto, { status: 201 })
    clear(@CurrentUser() user: User, @Param('chatId') chatId: string): Promise<AgentChatView> {
        return this.manager.clearChat(user.id, chatId)
    }

    @Delete(':chatId')
    @ApiOperation({ summary: '删除单 Agent 聊天' })
    @ApiEnvelope(DeleteAgentChatResultDto)
    remove(@CurrentUser() user: User, @Param('chatId') chatId: string): Promise<{ deleted: true }> {
        return this.manager.removeChat(user.id, chatId)
    }
}
