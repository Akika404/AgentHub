import { ApiProperty } from '@nestjs/swagger'
import { PROVIDER_TYPES, type ProviderType } from '../entities/platform-provider.entity.js'
import type { PlatformProviderView, ProviderTestResult } from './platform-provider-view.dto.js'

/**
 * 响应侧 DTO（Swagger 文档模型）。
 *
 * platform-provider-view.dto.ts 里的接口编译后被擦除、运行时无元数据，Swagger 无法据其
 * 生成 schema。这里用 class 镜像同一形状并 `implements` 对应接口——字段一旦与契约不符即
 * 编译报错，因此接口仍是唯一契约，本文件只为出文档。
 */
export class PlatformProviderViewDto implements PlatformProviderView {
    @ApiProperty({ description: 'Provider id' })
    id!: string

    @ApiProperty({ description: '平台展示名（同一用户下唯一）' })
    platformName!: string

    @ApiProperty({ enum: PROVIDER_TYPES, description: '接入协议类型' })
    type!: ProviderType

    @ApiProperty({ description: '上游 base url' })
    baseUrl!: string

    @ApiProperty({ type: [String], description: '模型名列表' })
    modelList!: string[]

    @ApiProperty({ description: '是否为当前用户默认 Provider' })
    isDefault!: boolean

    @ApiProperty({ type: String, nullable: true, description: '默认模型；非默认 Provider 为 null' })
    defaultModel!: string | null

    @ApiProperty({
        type: String,
        nullable: true,
        description: 'API 密钥掩码（如 sk-****wl7g）；无密钥时为 null。绝不回明文'
    })
    apiKeyMasked!: string | null

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string

    @ApiProperty({ description: '更新时间，ISO8601' })
    updatedAt!: string
}

/** 测试连接的返回 */
export class ProviderTestResultDto implements ProviderTestResult {
    @ApiProperty({ description: '是否连通' })
    ok!: boolean

    @ApiProperty({ description: '本次探测耗时（毫秒）' })
    latencyMs!: number

    @ApiProperty({ required: false, description: '连通时拉到的可用模型数量' })
    modelCount?: number

    @ApiProperty({ required: false, description: '失败原因；ok 为 true 时不返回' })
    message?: string
}

/** 删除 Provider 的返回 */
export class DeletePlatformProviderResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已删除' })
    deleted!: true
}
