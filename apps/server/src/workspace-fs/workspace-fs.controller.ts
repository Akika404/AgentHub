import {
    Controller,
    Get,
    Post,
    Query,
    UploadedFile,
    UseGuards,
    UseInterceptors
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type {
    ImportedSkillFolderView,
    ServerDirectoryListing,
    ServerDirectoryRoot
} from '@agenthub/shared'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../user/auth/current-user.decorator.js'
import { User } from '../user/entities/user.entity.js'
import {
    ImportedSkillFolderViewDto,
    ServerDirectoryListingDto,
    ServerDirectoryRootDto
} from './dto/workspace-fs-response.dto.js'
import {
    MAX_LOCAL_SKILL_IMPORT_MANIFEST_BYTES,
    type UploadedLocalSkillManifestFile,
    WorkspaceFsService
} from './workspace-fs.service.js'

@ApiTags('workspace-fs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workspace-fs')
export class WorkspaceFsController {
    constructor(private readonly workspaceFs: WorkspaceFsService) {}

    @Get('roots')
    @ApiOperation({ summary: '列出当前后端允许浏览的服务器目录根' })
    @ApiEnvelope(ServerDirectoryRootDto, { isArray: true })
    roots(@CurrentUser() user: User): Promise<ServerDirectoryRoot[]> {
        return this.workspaceFs.roots(user.id)
    }

    @Get('directories')
    @ApiOperation({ summary: '列出服务器目录下的一级子目录' })
    @ApiEnvelope(ServerDirectoryListingDto)
    directories(
        @CurrentUser() user: User,
        @Query('path') path?: string
    ): Promise<ServerDirectoryListing> {
        return this.workspaceFs.listDirectories(user.id, path)
    }

    @Post('skills/import-local')
    @UseInterceptors(
        FileInterceptor('manifest', {
            limits: { fileSize: MAX_LOCAL_SKILL_IMPORT_MANIFEST_BYTES, files: 1 }
        })
    )
    @ApiOperation({
        summary: '上传用户本地 Skill 文件夹到服务器 Skills 根目录',
        description:
            '桌面端先读取本地文件夹为 JSON manifest，再以 multipart manifest 文件上传；后端写入当前用户服务器 skills root，并返回可传给 Agent skillSourceDirectories 的服务器目录。'
    })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['manifest'],
            properties: {
                manifest: { type: 'string', format: 'binary' }
            }
        }
    })
    @ApiEnvelope(ImportedSkillFolderViewDto, { status: 201 })
    importLocalSkillFolder(
        @CurrentUser() user: User,
        @UploadedFile() file?: UploadedLocalSkillManifestFile
    ): Promise<ImportedSkillFolderView> {
        return this.workspaceFs.importLocalSkillFolder(user.id, file)
    }
}
