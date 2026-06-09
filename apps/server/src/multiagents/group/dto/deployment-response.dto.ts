import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type {
    DeployManifest,
    DeployMode,
    DeploymentRunnerKind,
    DeploymentStatus,
    DeploymentView,
    StartDeploymentPayload
} from '@agenthub/shared'

const DEPLOY_MODES: DeployMode[] = ['static', 'service']
const DEPLOYMENT_STATUSES: DeploymentStatus[] = [
    'installing',
    'starting',
    'running',
    'stopped',
    'failed'
]
const RUNNER_KINDS: DeploymentRunnerKind[] = ['local', 'docker']

/** 部署清单（镜像 shared DeployManifest）。service 模式需 command + port。 */
export class DeployManifestDto implements DeployManifest {
    @ApiProperty({ enum: DEPLOY_MODES, description: 'static 直接预览 / service 起 dev server' })
    @IsIn(DEPLOY_MODES)
    mode!: DeployMode

    @ApiPropertyOptional({ type: String, description: '入口产物的工作区相对路径' })
    @IsOptional()
    @IsString()
    entryPath?: string

    @ApiPropertyOptional({ type: String, description: 'service：启动 dev server 的命令' })
    @IsOptional()
    @IsString()
    command?: string

    @ApiPropertyOptional({ type: String, description: 'service：缺依赖时先执行的安装命令' })
    @IsOptional()
    @IsString()
    installCommand?: string

    @ApiPropertyOptional({ type: Number, description: 'service：dev server 监听端口' })
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(65535)
    port?: number

    @ApiPropertyOptional({ type: String, description: '卡片上展示的一句话说明' })
    @IsOptional()
    @IsString()
    note?: string
}

/** 启动 service 部署的请求体。 */
export class StartDeploymentDto implements StartDeploymentPayload {
    @ApiProperty({ type: DeployManifestDto, description: '来自 deploy 卡片的部署清单' })
    @ValidateNested()
    @Type(() => DeployManifestDto)
    manifest!: DeployManifestDto
}

/** 运行中（或已结束）的部署视图。 */
export class DeploymentViewDto implements DeploymentView {
    @ApiProperty({ description: '部署 id' })
    id!: string

    @ApiProperty({ description: '所属群聊 id' })
    groupChatId!: string

    @ApiProperty({ enum: DEPLOYMENT_STATUSES, description: '生命周期状态' })
    status!: DeploymentStatus

    @ApiProperty({ enum: RUNNER_KINDS, description: '运行后端（local / 预留 docker）' })
    runnerKind!: DeploymentRunnerKind

    @ApiProperty({ type: Number, nullable: true, description: '运行中的端口；未就绪为 null' })
    port!: number | null

    @ApiProperty({ type: String, nullable: true, description: 'iframe 加载的地址；未就绪为 null' })
    url!: string | null

    @ApiProperty({ type: String, nullable: true, description: 'status===failed 时的错误信息' })
    error!: string | null

    @ApiProperty({ description: '启动时间，ISO8601' })
    startedAt!: string

    @ApiProperty({ description: '更新时间，ISO8601' })
    updatedAt!: string
}

export class StopDeploymentResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已请求停止' })
    stopped!: true
}
