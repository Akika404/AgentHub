import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength
} from 'class-validator'
import { PROVIDER_TYPES, type ProviderType } from '../entities/platform-provider.entity.js'

/**
 * 修改 Provider 的入参（部分更新）。
 *
 * 所有字段可选，只更新传入的字段。`apiKey` 省略时保留原密钥，传入则覆盖；
 * `modelList` 传入则整体替换。
 */
export class UpdatePlatformProviderDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    platformName?: string

    @IsOptional()
    @IsIn(PROVIDER_TYPES)
    type?: ProviderType

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(512)
    @Matches(/^https?:\/\//, { message: 'baseUrl 必须以 http:// 或 https:// 开头' })
    baseUrl?: string

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(1024)
    apiKey?: string

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @IsString({ each: true })
    modelList?: string[]
}
