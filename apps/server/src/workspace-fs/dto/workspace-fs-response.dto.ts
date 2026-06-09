import { ApiProperty } from '@nestjs/swagger'
import type {
    ImportedSkillFolderView,
    ServerDirectoryEntry,
    ServerDirectoryListing,
    ServerDirectoryRoot,
    ServerDirectoryRootKind
} from '@agenthub/shared'

export class ServerDirectoryRootDto implements ServerDirectoryRoot {
    @ApiProperty({ description: '稳定 id；当前等于规范化后的服务器根路径' })
    id!: string

    @ApiProperty({ description: '服务器上的绝对路径' })
    path!: string

    @ApiProperty({ description: '根目录选择器展示名' })
    label!: string

    @ApiProperty({
        enum: ['skills', 'agent_home', 'agent_workspace'],
        required: false,
        description: '根目录用途'
    })
    kind?: ServerDirectoryRootKind
}

export class ServerDirectoryEntryDto implements ServerDirectoryEntry {
    @ApiProperty({ description: '目录名' })
    name!: string

    @ApiProperty({ description: '服务器上的绝对路径' })
    path!: string

    @ApiProperty({ description: '当前后端进程用户是否可读取/进入该目录' })
    readable!: boolean
}

export class ServerDirectoryListingDto implements ServerDirectoryListing {
    @ApiProperty({ type: ServerDirectoryRootDto, description: '该路径所属的可浏览根目录' })
    root!: ServerDirectoryRootDto

    @ApiProperty({ description: '本次列出的服务器绝对路径' })
    path!: string

    @ApiProperty({
        type: String,
        nullable: true,
        description: '同一根目录内的父路径；已经位于根目录时为 null'
    })
    parentPath!: string | null

    @ApiProperty({ type: [ServerDirectoryEntryDto], description: '子目录列表' })
    entries!: ServerDirectoryEntryDto[]
}

export class ImportedSkillFolderViewDto implements ImportedSkillFolderView {
    @ApiProperty({
        description: '上传后写入的服务器端目录，可作为 Agent skillSourceDirectories 使用'
    })
    directory!: string

    @ApiProperty({ type: [String], description: '从上传目录中识别出的 Skill 名称' })
    skills!: string[]

    @ApiProperty({ description: '写入的文件数量' })
    fileCount!: number
}
