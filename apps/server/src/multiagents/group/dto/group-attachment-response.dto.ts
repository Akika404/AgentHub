import { ApiProperty } from '@nestjs/swagger'
import type {
    BlackboardArtifactPreviewKind,
    GroupAttachmentPreview,
    GroupAttachmentView
} from '@agenthub/shared'

const ATTACHMENT_PREVIEW_KINDS: BlackboardArtifactPreviewKind[] = [
    'text',
    'html',
    'pdf',
    'image',
    'audio',
    'video',
    'office',
    'binary',
    'too_large'
]

/** Uploaded group attachment metadata. */
export class GroupAttachmentViewDto implements GroupAttachmentView {
    @ApiProperty({ description: '附件 id' })
    id!: string

    @ApiProperty({ description: '所属群聊 id' })
    groupChatId!: string

    @ApiProperty({ description: '用户上传时的原始文件名' })
    originalName!: string

    @ApiProperty({ description: 'MIME 类型' })
    mimeType!: string

    @ApiProperty({ description: '文件大小（bytes）' })
    size!: number

    @ApiProperty({
        type: String,
        nullable: true,
        description: '工作区相对路径；发送消息并启动 run 后才会写入'
    })
    workspacePath!: string | null

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string
}

/** Uploaded group attachment preview payload. */
export class GroupAttachmentPreviewDto implements GroupAttachmentPreview {
    @ApiProperty({ type: GroupAttachmentViewDto })
    attachment!: GroupAttachmentViewDto

    @ApiProperty()
    fileName!: string

    @ApiProperty()
    extension!: string

    @ApiProperty()
    mimeType!: string

    @ApiProperty()
    size!: number

    @ApiProperty({ enum: ATTACHMENT_PREVIEW_KINDS })
    previewKind!: BlackboardArtifactPreviewKind

    @ApiProperty({ type: String, nullable: true })
    content!: string | null

    @ApiProperty({ type: String, nullable: true })
    dataUrl!: string | null

    @ApiProperty({ type: String, nullable: true })
    message!: string | null
}
