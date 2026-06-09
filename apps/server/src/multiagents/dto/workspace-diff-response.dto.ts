import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type {
    WorkspaceCommitResult,
    WorkspaceDiffFile,
    WorkspaceDiffFileStatus,
    WorkspaceDiffSummary
} from '@agenthub/shared'

const FILE_STATUSES: WorkspaceDiffFileStatus[] = [
    'added',
    'modified',
    'deleted',
    'renamed',
    'untracked',
    'other'
]

export class WorkspaceDiffFileDto implements WorkspaceDiffFile {
    @ApiProperty({ description: '工作区相对路径' })
    path!: string

    @ApiPropertyOptional({ type: String, nullable: true, description: '重命名前路径' })
    oldPath?: string | null

    @ApiProperty({ enum: FILE_STATUSES, description: '文件变更状态' })
    status!: WorkspaceDiffFileStatus

    @ApiProperty({ description: '新增行数' })
    additions!: number

    @ApiProperty({ description: '删除行数' })
    deletions!: number

    @ApiProperty({ type: String, nullable: true, description: '单文件 diff；不可展开时为 null' })
    diff!: string | null

    @ApiProperty({ description: '是否可在前端展开 diff' })
    expandable!: boolean

    @ApiProperty({ description: 'diff 是否因过长被省略' })
    tooLarge!: boolean
}

export class WorkspaceDiffSummaryDto implements WorkspaceDiffSummary {
    @ApiProperty({ description: 'diff 摘要 id' })
    id!: string

    @ApiProperty({ enum: ['agent-chat', 'group-chat'], description: '工作区归属类型' })
    scope!: WorkspaceDiffSummary['scope']

    @ApiProperty({ description: '归属会话 id' })
    ownerId!: string

    @ApiProperty({ type: String, nullable: true, description: '当前 HEAD 简短 hash' })
    baseRef!: string | null

    @ApiProperty({ type: String, nullable: true, description: '当前 HEAD 简短 hash' })
    headRef!: string | null

    @ApiProperty({ description: '是否没有可见未提交变更' })
    clean!: boolean

    @ApiProperty({ type: [WorkspaceDiffFileDto], description: '文件变更列表' })
    files!: WorkspaceDiffFileDto[]

    @ApiProperty({ description: '生成时间，ISO8601' })
    generatedAt!: string
}

export class WorkspaceCommitResultDto implements WorkspaceCommitResult {
    @ApiProperty({ description: '是否创建了提交' })
    committed!: boolean

    @ApiProperty({ type: String, nullable: true, description: '提交 hash；未提交时为 null' })
    commitHash!: string | null

    @ApiProperty({ type: String, nullable: true, description: '实际提交信息；未提交时为 null' })
    message!: string | null

    @ApiProperty({ type: WorkspaceDiffSummaryDto, description: '提交后的工作区 diff 快照' })
    diff!: WorkspaceDiffSummaryDto
}
