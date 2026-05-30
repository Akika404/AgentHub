import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../user/auth/current-user.decorator.js'
import type { User } from '../user/entities/user.entity.js'
import { PlatformProviderService } from './platform-provider.service.js'
import { CreatePlatformProviderDto } from './dto/create-platform-provider.dto.js'
import { UpdatePlatformProviderDto } from './dto/update-platform-provider.dto.js'
import type { PlatformProviderView, ProviderTestResult } from './dto/platform-provider-view.dto.js'
import {
    DeletePlatformProviderResultDto,
    PlatformProviderViewDto,
    ProviderTestResultDto
} from './dto/platform-provider-response.dto.js'

/**
 * Provider 管理：用户自建模型平台的增删改查 + 连接测试 + 模型拉取。
 *
 * 整个控制器走 JwtAuthGuard，所有操作均按当前登录用户隔离（@CurrentUser 取用户实体）。
 */
@ApiTags('platform-provider')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('platform-providers')
export class PlatformProviderController {
    constructor(private readonly providerService: PlatformProviderService) {}

    @Post()
    @ApiOperation({ summary: '添加 Provider', description: '同一用户下 platformName 唯一' })
    @ApiEnvelope(PlatformProviderViewDto, { status: 201 })
    create(
        @CurrentUser() user: User,
        @Body() dto: CreatePlatformProviderDto
    ): Promise<PlatformProviderView> {
        return this.providerService.create(user.id, dto)
    }

    @Get()
    @ApiOperation({ summary: '列出当前用户的全部 Provider' })
    @ApiEnvelope(PlatformProviderViewDto, { isArray: true })
    list(@CurrentUser() user: User): Promise<PlatformProviderView[]> {
        return this.providerService.list(user.id)
    }

    @Get(':id')
    @ApiOperation({ summary: '查询单个 Provider 详情' })
    @ApiEnvelope(PlatformProviderViewDto)
    get(@CurrentUser() user: User, @Param('id') id: string): Promise<PlatformProviderView> {
        return this.providerService.get(user.id, id)
    }

    @Patch(':id')
    @ApiOperation({
        summary: '修改 Provider',
        description: '部分更新，只覆盖传入字段；apiKey 省略则保留原密钥'
    })
    @ApiEnvelope(PlatformProviderViewDto)
    update(
        @CurrentUser() user: User,
        @Param('id') id: string,
        @Body() dto: UpdatePlatformProviderDto
    ): Promise<PlatformProviderView> {
        return this.providerService.update(user.id, id, dto)
    }

    @Delete(':id')
    @ApiOperation({ summary: '删除 Provider' })
    @ApiEnvelope(DeletePlatformProviderResultDto)
    remove(@CurrentUser() user: User, @Param('id') id: string): Promise<{ deleted: true }> {
        return this.providerService.remove(user.id, id)
    }

    @Post(':id/test')
    @ApiOperation({
        summary: '测试连接',
        description: '用已存配置打一次上游列模型接口；失败返回 ok:false 与原因，不抛错'
    })
    @ApiEnvelope(ProviderTestResultDto, { status: 201 })
    test(@CurrentUser() user: User, @Param('id') id: string): Promise<ProviderTestResult> {
        return this.providerService.test(user.id, id)
    }

    @Post(':id/models/refresh')
    @ApiOperation({
        summary: '拉取并刷新模型列表',
        description: '从上游拉取可用模型，整体覆盖 modelList，返回更新后的 Provider'
    })
    @ApiEnvelope(PlatformProviderViewDto, { status: 201 })
    refreshModels(
        @CurrentUser() user: User,
        @Param('id') id: string
    ): Promise<PlatformProviderView> {
        return this.providerService.refreshModels(user.id, id)
    }
}
