import { ApiProperty } from '@nestjs/swagger'

/** Uploaded group attachment metadata. */
export class GroupAttachmentViewDto {
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
