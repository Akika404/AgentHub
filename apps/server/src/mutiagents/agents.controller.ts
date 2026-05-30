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
} from '@nestjs/common'
import type { Request } from 'express'
import { Observable, from, map } from 'rxjs'
import { SkipEnvelope } from '../common/decorators/skip-envelope.decorator.js'
import { AgentManager } from './agent-manager.service.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import { ConverseDto } from './dto/converse.dto.js'
import type { AgentView, CreateAgentResult } from './dto/agent-view.dto.js'

@Controller('agents')
export class AgentsController {
  constructor(private readonly manager: AgentManager) {}

  /** 创建一个虚拟员工（持久化 spec + 开一个会话句柄） */
  @Post()
  create(@Body() dto: CreateAgentDto): Promise<CreateAgentResult> {
    return this.manager.createAgentSession(dto)
  }

  @Get()
  list(): Promise<AgentView[]> {
    return this.manager.list()
  }

  @Get(':sessionId')
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
  async converse(
    @Param('sessionId') sessionId: string,
    @Query() query: ConverseDto,
    @Req() req: Request,
  ): Promise<Observable<MessageEvent>> {
    const abort = new AbortController()
    req.on('close', () => abort.abort())
    const stream = await this.manager.converse(sessionId, query.prompt, abort.signal)
    return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
  }

  @Post(':sessionId/suspend')
  suspend(@Param('sessionId') sessionId: string): Promise<AgentView> {
    return this.manager.suspend(sessionId)
  }

  @Post(':sessionId/restore')
  restore(@Param('sessionId') sessionId: string): Promise<AgentView> {
    return this.manager.restore(sessionId)
  }

  @Post(':sessionId/clear')
  clear(@Param('sessionId') sessionId: string): Promise<AgentView> {
    return this.manager.clear(sessionId)
  }

  @Delete(':sessionId')
  remove(@Param('sessionId') sessionId: string): Promise<{ deleted: true }> {
    return this.manager.remove(sessionId)
  }
}
