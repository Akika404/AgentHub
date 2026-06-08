import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { ServerDirectoryListing, ServerDirectoryRoot } from '@agenthub/shared'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import {
    ServerDirectoryListingDto,
    ServerDirectoryRootDto
} from './dto/workspace-fs-response.dto.js'
import { WorkspaceFsService } from './workspace-fs.service.js'

@ApiTags('workspace-fs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace-fs')
export class WorkspaceFsController {
    constructor(private readonly workspaceFs: WorkspaceFsService) {}

    @Get('roots')
    @ApiOperation({ summary: '列出当前后端允许浏览的服务器目录根' })
    @ApiEnvelope(ServerDirectoryRootDto, { isArray: true })
    roots(): Promise<ServerDirectoryRoot[]> {
        return this.workspaceFs.roots()
    }

    @Get('directories')
    @ApiOperation({ summary: '列出服务器目录下的一级子目录' })
    @ApiEnvelope(ServerDirectoryListingDto)
    directories(@Query('path') path?: string): Promise<ServerDirectoryListing> {
        return this.workspaceFs.listDirectories(path)
    }
}
