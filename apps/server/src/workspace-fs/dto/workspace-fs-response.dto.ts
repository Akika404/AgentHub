import { ApiProperty } from '@nestjs/swagger'
import type {
    ServerDirectoryEntry,
    ServerDirectoryListing,
    ServerDirectoryRoot
} from '@agenthub/shared'

export class ServerDirectoryRootDto implements ServerDirectoryRoot {
    @ApiProperty({ description: '稳定 id；当前等于规范化后的服务器根路径' })
    id!: string

    @ApiProperty({ description: '服务器上的绝对路径' })
    path!: string

    @ApiProperty({ description: '根目录选择器展示名' })
    label!: string
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
