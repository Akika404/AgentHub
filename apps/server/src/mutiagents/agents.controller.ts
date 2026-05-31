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
import { CreateAgentDto } from './dto/create-agent.dto.js'
import { ConverseDto } from './dto/converse.dto.js'
import type { AgentView } from './dto/agent-view.dto.js'
import { AgentViewDto, DeleteAgentResultDto } from './dto/agent-response.dto.js'

/**
 * Agent 管理：用户虚拟员工（AgentList）的增删查 + 单聊对话（SSE）+ 会话生命周期。
 *
 * 整个控制器走 JwtAuthGuard，所有操作均按当前登录用户隔离（@CurrentUser 取用户实体）。
 * Agent 与会话解耦：创建只落配置；converse/suspend/restore/clear 按 agentId 作用于单聊会话。
 */
@ApiTags('agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
    constructor(private readonly manager: AgentManager) {}

    /** 创建一个虚拟员工（只持久化 Agent 配置，进入当前用户的 AgentList，不开会话） */
    @Post()
    @ApiOperation({
        summary: '创建 Agent',
        description: '持久化 Agent 配置（引用 Provider 取凭证），进入当前用户的 AgentList，不开会话'
    })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    create(@CurrentUser() user: User, @Body() dto: CreateAgentDto): Promise<AgentView> {
        return this.manager.createAgent(user.id, dto)
    }

    @Get()
    @ApiOperation({ summary: '列出当前用户的全部 Agent（AgentList）' })
    @ApiEnvelope(AgentViewDto, { isArray: true })
    list(@CurrentUser() user: User): Promise<AgentView[]> {
        return this.manager.list(user.id)
    }

    @Get(':agentId')
    @ApiOperation({ summary: '查询单个 Agent' })
    @ApiEnvelope(AgentViewDto)
    get(@CurrentUser() user: User, @Param('agentId') agentId: string): Promise<AgentView> {
        return this.manager.get(user.id, agentId)
    }

    /**
     * 与 agent 单聊，SSE 推送统一 AgentEvent。
     *
     * - NOT_FOUND / AGENT_BUSY 在流建立前抛出，经异常过滤器返回标准 JSON 错误。
     * - 每个事件包成 { data: ev }，避免 AgentEvent.type 被 SSE 当作事件名。
     * - 客户端断连：req 'close' → abort 信号；RxJS 退订 → iterator.return() →
     *   Manager 生成器 finally（回写句柄 + 释放 busy）+ adapter finally（done）。
     */
    @Sse(':agentId/converse')
    @SkipEnvelope()
    @ApiOperation({
        summary: '与 agent 单聊（SSE 流）',
        description:
            '返回 text/event-stream，逐条推送统一 AgentEvent（包成 { data: ev }）。' +
            '按 agentId 懒加载/复用单聊会话。' +
            '注意：此接口为流式响应，Scalar/Swagger 的「Try it」无法良好展示流，建议用 EventSource 或 curl 调试。' +
            'NOT_FOUND / AGENT_BUSY 在流建立前以标准 JSON 错误返回。'
    })
    @ApiProduces('text/event-stream')
    async converse(
        @CurrentUser() user: User,
        @Param('agentId') agentId: string,
        @Query() query: ConverseDto,
        @Req() req: Request
    ): Promise<Observable<MessageEvent>> {
        const abort = new AbortController()
        req.on('close', () => abort.abort())
        const stream = await this.manager.converse(user.id, agentId, query.prompt, abort.signal)
        return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
    }

    @Post(':agentId/suspend')
    @ApiOperation({ summary: '暂存单聊会话', description: '从内存驱逐，可恢复' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    suspend(@CurrentUser() user: User, @Param('agentId') agentId: string): Promise<AgentView> {
        return this.manager.suspend(user.id, agentId)
    }

    @Post(':agentId/restore')
    @ApiOperation({ summary: '恢复单聊会话', description: '用 Agent 配置重建 adapter 并续接底层会话' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    restore(@CurrentUser() user: User, @Param('agentId') agentId: string): Promise<AgentView> {
        return this.manager.restore(user.id, agentId)
    }

    @Post(':agentId/clear')
    @ApiOperation({ summary: '清空单聊会话', description: '丢弃底层句柄，下次对话开新会话' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    clear(@CurrentUser() user: User, @Param('agentId') agentId: string): Promise<AgentView> {
        return this.manager.clear(user.id, agentId)
    }

    @Delete(':agentId')
    @ApiOperation({ summary: '删除 Agent', description: '连同其会话一并删除' })
    @ApiEnvelope(DeleteAgentResultDto)
    remove(
        @CurrentUser() user: User,
        @Param('agentId') agentId: string
    ): Promise<{ deleted: true }> {
        return this.manager.remove(user.id, agentId)
    }
}
