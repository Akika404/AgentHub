import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../user/auth/current-user.decorator.js'
import type { User } from '../user/entities/user.entity.js'
import { AgentManager } from './agent-manager.service.js'
import { CreateAgentDto } from './dto/create-agent.dto.js'
import type { AgentView } from './dto/agent-view.dto.js'
import { AgentViewDto, DeleteAgentResultDto } from './dto/agent-response.dto.js'

/**
 * Agent 管理：用户虚拟员工（AgentList）的增删查。
 *
 * 单 Agent 聊天会话不再挂在 `/agents/:agentId/*` 下，统一由
 * `AgentChatsController` 的 `/agent-chats` 路由处理。
 */
@ApiTags('agents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents')
export class AgentsController {
    constructor(private readonly manager: AgentManager) {}

    /** 创建一个虚拟员工（只持久化 Agent 配置，进入当前用户的 AgentList，不开聊天会话） */
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

    @Delete(':agentId')
    @ApiOperation({ summary: '删除 Agent', description: '连同该 Agent 的所有单聊会话一并删除' })
    @ApiEnvelope(DeleteAgentResultDto)
    remove(
        @CurrentUser() user: User,
        @Param('agentId') agentId: string
    ): Promise<{ deleted: true }> {
        return this.manager.remove(user.id, agentId)
    }
}
