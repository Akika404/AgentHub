import {
    Body,
    Controller,
    Delete,
    Get,
    MessageEvent,
    Param,
    Post,
    Query,
    Req,
    Sse,
    UseGuards
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Observable, from, map } from 'rxjs'
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator.js'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../user/auth/current-user.decorator.js'
import type { User } from '../user/entities/user.entity.js'
import { AgentManager } from './agent-manager.service.js'
import { CreateAgentChatDto } from './dto/create-agent-chat.dto.js'
import { ConverseDto } from './dto/converse.dto.js'
import type { AgentChatView } from './dto/agent-chat-view.dto.js'
import { AgentChatViewDto, DeleteAgentChatResultDto } from './dto/agent-chat-response.dto.js'
import type { AgentChatMessageView } from './dto/agent-message-view.dto.js'
import { AgentChatMessageViewDto } from './dto/agent-message-response.dto.js'

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
            '选择一个已有 Agent 创建独立聊天会话。workingDirectory 为会话级必填；systemPrompt 继承 Agent 配置。'
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

    @Get(':chatId/messages')
    @ApiOperation({ summary: '查询单 Agent 聊天消息历史' })
    @ApiEnvelope(AgentChatMessageViewDto, { isArray: true })
    listMessages(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string
    ): Promise<AgentChatMessageView[]> {
        return this.manager.listChatMessages(user.id, chatId)
    }

    @Sse(':chatId/converse')
    @SkipEnvelope()
    @ApiOperation({
        summary: '与单 Agent 聊天会话对话（SSE 流）',
        description:
            '返回 text/event-stream，逐条推送统一 AgentEvent。按 chatId 复用/恢复该聊天自己的 SDK 会话。'
    })
    @ApiProduces('text/event-stream')
    async converse(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string,
        @Query() query: ConverseDto,
        @Req() req: Request
    ): Promise<Observable<MessageEvent>> {
        const abort = new AbortController()
        req.on('close', () => abort.abort())
        const stream = await this.manager.converseChat(user.id, chatId, query.prompt, abort.signal)
        return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
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
    remove(
        @CurrentUser() user: User,
        @Param('chatId') chatId: string
    ): Promise<{ deleted: true }> {
        return this.manager.removeChat(user.id, chatId)
    }
}
