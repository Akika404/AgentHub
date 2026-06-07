import {
    Body,
    Controller,
    Delete,
    Get,
    MessageEvent,
    Param,
    Patch,
    Post,
    Query,
    Sse,
    UseGuards
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import { Observable, from, map } from 'rxjs'
import type {
    BlackboardArtifactPreview,
    BlackboardEventView,
    BlackboardView,
    GroupChatView,
    GroupMessageView
} from '@agenthub/shared'
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator.js'
import { ApiEnvelope } from '../../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../../user/auth/current-user.decorator.js'
import type { User } from '../../user/entities/user.entity.js'
import { GroupChatManager } from './group-chat.manager.js'
import { CreateGroupChatDto } from './dto/create-group-chat.dto.js'
import { UpdateGroupChatDto } from './dto/update-group-chat.dto.js'
import { ConverseGroupDto } from './dto/converse-group.dto.js'
import {
    AbortGroupRunResultDto,
    DeleteGroupChatResultDto,
    GroupChatViewDto,
    StartGroupRunResultDto
} from './dto/group-chat-response.dto.js'
import { GroupMessageViewDto } from './dto/group-message-response.dto.js'
import {
    BlackboardArtifactPreviewDto,
    BlackboardEventViewDto,
    BlackboardViewDto
} from './dto/blackboard-response.dto.js'

@ApiTags('group-chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('group-chats')
export class GroupChatController {
    constructor(private readonly manager: GroupChatManager) {}

    // —— 群聊管理 ——

    @Post()
    @ApiOperation({
        summary: '创建群聊',
        description:
            '选择成员 Agent + 配置独立 Orchestrator（vendor/model/provider）+ 项目元信息。workspaceDir 优先使用用户指定目录，未指定时后端分配，并初始化为 git 仓库。'
    })
    @ApiEnvelope(GroupChatViewDto, { status: 201 })
    create(@CurrentUser() user: User, @Body() dto: CreateGroupChatDto): Promise<GroupChatView> {
        return this.manager.createGroupChat(user.id, dto)
    }

    @Get()
    @ApiOperation({ summary: '列出当前用户的全部群聊' })
    @ApiEnvelope(GroupChatViewDto, { isArray: true })
    list(@CurrentUser() user: User): Promise<GroupChatView[]> {
        return this.manager.listGroupChats(user.id)
    }

    @Get(':id')
    @ApiOperation({ summary: '查询群详情（成员、Orchestrator、projectMeta、activeRunId）' })
    @ApiEnvelope(GroupChatViewDto)
    get(@CurrentUser() user: User, @Param('id') id: string): Promise<GroupChatView> {
        return this.manager.getGroupChat(user.id, id)
    }

    @Patch(':id')
    @ApiOperation({ summary: '修改群聊（标题 / projectMeta / 加成员）' })
    @ApiEnvelope(GroupChatViewDto)
    update(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Body() dto: UpdateGroupChatDto
    ): Promise<GroupChatView> {
        return this.manager.updateGroupChat(user.id, id, dto)
    }

    @Delete(':id')
    @ApiOperation({ summary: '删除群聊（级联删数据库记录；工作区 ACTIVE 标记置 false，不删除目录）' })
    @ApiEnvelope(DeleteGroupChatResultDto)
    remove(@CurrentUser() user: User, @Param('id') id: string): Promise<{ deleted: true }> {
        return this.manager.deleteGroupChat(user.id, id)
    }

    // —— 群聊会话 ——

    @Get(':id/messages')
    @ApiOperation({ summary: '查询群聊展示层消息历史（升序，多发言者）' })
    @ApiEnvelope(GroupMessageViewDto, { isArray: true })
    listMessages(
        @CurrentUser() user: User,
        @Param('id') id: string
    ): Promise<GroupMessageView[]> {
        return this.manager.listMessages(user.id, id)
    }

    @Post(':id/converse')
    @ApiOperation({
        summary: '发消息，启动一次群运行（后台游离）',
        description:
            '解析 @mentions 决定去向，启动一次群运行并立即返回 runId。订阅 runs/:runId/events 观看进度。群已有进行中运行时返回冲突，请订阅 activeRunId。'
    })
    @ApiEnvelope(StartGroupRunResultDto, { status: 201 })
    converse(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Body() dto: ConverseGroupDto
    ): Promise<{ runId: string }> {
        return this.manager.converse(user.id, id, dto)
    }

    @Sse(':id/runs/:runId/events')
    @SkipEnvelope()
    @ApiOperation({
        summary: '订阅群运行事件流（SSE，回放 + 实时追尾）',
        description:
            '返回 text/event-stream，逐条推送 GroupRunEvent（编排计划 / 任务状态 / 成员 turn 透传 / 黑板更新 / 汇报），遇 done 结束。断开不中止运行，可多端围观。'
    })
    @ApiProduces('text/event-stream')
    async runEvents(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Param('runId') runId: string
    ): Promise<Observable<MessageEvent>> {
        const stream = await this.manager.subscribeRun(user.id, id, runId)
        return from(stream).pipe(map((ev): MessageEvent => ({ data: ev as object })))
    }

    @Post(':id/runs/:runId/abort')
    @ApiOperation({ summary: '中止整个群运行（跨实例广播，连带中止其下成员 turn）' })
    @ApiEnvelope(AbortGroupRunResultDto, { status: 201 })
    abort(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Param('runId') runId: string
    ): Promise<{ aborted: true }> {
        return this.manager.abortRun(user.id, id, runId)
    }

    // —— 黑板（只读 + 调试）——

    @Get(':id/blackboard')
    @ApiOperation({ summary: '黑板状态快照（artifacts/decisions/contracts/taskGraph）' })
    @ApiEnvelope(BlackboardViewDto)
    blackboard(@CurrentUser() user: User, @Param('id') id: string): Promise<BlackboardView> {
        return this.manager.getBlackboard(user.id, id)
    }

    @Get(':id/blackboard/artifacts/:artifactId/preview')
    @ApiOperation({ summary: '读取黑板产出物对应文件的预览内容' })
    @ApiEnvelope(BlackboardArtifactPreviewDto)
    artifactPreview(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Param('artifactId') artifactId: string
    ): Promise<BlackboardArtifactPreview> {
        return this.manager.getArtifactPreview(user.id, id, artifactId)
    }

    @Get(':id/blackboard/events')
    @ApiOperation({ summary: '黑板事件流（审计 / 调试，分页）' })
    @ApiEnvelope(BlackboardEventViewDto, { isArray: true })
    blackboardEvents(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Query('limit') limit?: string,
        @Query('offset') offset?: string
    ): Promise<BlackboardEventView[]> {
        return this.manager.listBlackboardEvents(
            user.id,
            id,
            limit ? Number(limit) : undefined,
            offset ? Number(offset) : undefined
        )
    }
}
