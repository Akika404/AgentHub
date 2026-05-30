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
    Sse
} from '@nestjs/common'
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Observable, from, map } from 'rxjs'
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator.js'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { AgentManager } from './agent-manager.service.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import { ConverseDto } from './dto/converse.dto.js'
import type { AgentView, CreateAgentResult } from './dto/agent-view.dto.js'
import {
    AgentViewDto,
    CreateAgentResultDto,
    DeleteAgentResultDto
} from './dto/agent-response.dto.js'

@ApiTags('agents')
@Controller('agents')
export class AgentsController {
    constructor(private readonly manager: AgentManager) {}

    /** 创建一个虚拟员工（持久化 spec + 开一个会话句柄） */
    @Post()
    @ApiOperation({ summary: '创建 Agent 会话', description: '持久化 spec 并开一个会话句柄' })
    @ApiEnvelope(CreateAgentResultDto, { status: 201 })
    create(@Body() dto: CreateAgentDto): Promise<CreateAgentResult> {
        return this.manager.createAgentSession(dto)
    }

    @Get()
    @ApiOperation({ summary: '列出全部 Agent 会话' })
    @ApiEnvelope(AgentViewDto, { isArray: true })
    list(): Promise<AgentView[]> {
        return this.manager.list()
    }

    @Get(':sessionId')
    @ApiOperation({ summary: '查询单个 Agent 会话' })
    @ApiEnvelope(AgentViewDto)
    get(@Param('sessionId') sessionId: string): Promise<AgentView> {
        return this.manager.get(sessionId)
    }

    /**
     * 与 agent 对话，SSE 推送统一 AgentEvent。
     *
     * - NOT_FOUND / AGENT_BUSY 在流建立前抛出，经异常过滤器返回标准 JSON 错误。
     * - 每个事件包成 { data: ev }，避免 AgentEvent.type 被 SSE 当作事件名。
     * - 客户端断连：req 'close' → abort 信号；RxJS 退订 → iterator.return() →
     *   Manager 生成器 finally（回写句柄 + 释放 busy）+ adapter finally（done）。
     */
    @Sse(':sessionId/converse')
    @SkipEnvelope()
    @ApiOperation({
        summary: '与 agent 对话（SSE 流）',
        description:
            '返回 text/event-stream，逐条推送统一 AgentEvent（包成 { data: ev }）。' +
            '注意：此接口为流式响应，Scalar/Swagger 的「Try it」无法良好展示流，建议用 EventSource 或 curl 调试。' +
            'NOT_FOUND / AGENT_BUSY 在流建立前以标准 JSON 错误返回。'
    })
    @ApiProduces('text/event-stream')
    async converse(
        @Param('sessionId') sessionId: string,
        @Query() query: ConverseDto,
        @Req() req: Request
    ): Promise<Observable<MessageEvent>> {
        const abort = new AbortController()
        req.on('close', () => abort.abort())
        const stream = await this.manager.converse(sessionId, query.prompt, abort.signal)
        return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
    }

    @Post(':sessionId/suspend')
    @ApiOperation({ summary: '暂存会话', description: '从内存驱逐，可恢复' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    suspend(@Param('sessionId') sessionId: string): Promise<AgentView> {
        return this.manager.suspend(sessionId)
    }

    @Post(':sessionId/restore')
    @ApiOperation({ summary: '恢复会话', description: '用 spec 重建 adapter 并续接底层会话' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    restore(@Param('sessionId') sessionId: string): Promise<AgentView> {
        return this.manager.restore(sessionId)
    }

    @Post(':sessionId/clear')
    @ApiOperation({ summary: '清空会话', description: '丢弃底层句柄，下次对话开新会话' })
    @ApiEnvelope(AgentViewDto, { status: 201 })
    clear(@Param('sessionId') sessionId: string): Promise<AgentView> {
        return this.manager.clear(sessionId)
    }

    @Delete(':sessionId')
    @ApiOperation({ summary: '删除会话' })
    @ApiEnvelope(DeleteAgentResultDto)
    remove(@Param('sessionId') sessionId: string): Promise<{ deleted: true }> {
        return this.manager.remove(sessionId)
    }
}
