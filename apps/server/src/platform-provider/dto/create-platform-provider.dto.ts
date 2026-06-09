import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength
} from 'class-validator'
import { PROVIDER_TYPES, type ProviderType } from '../entities/platform-provider.entity.js'

/**
 * 添加 Provider 的入参。
 *
 * 全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted，未声明字段会被拒绝。
 * modelList 可省略，服务端默认存为空数组。
 */
export class CreatePlatformProviderDto {
    /** 平台展示名，同一用户下唯一 */
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    platformName!: string

    /** 接入协议类型 */
    @IsIn(PROVIDER_TYPES)
    type!: ProviderType

    /** 上游 base url，必须以 http(s):// 开头 */
    @IsString()
    @IsNotEmpty()
    @MaxLength(512)
    @Matches(/^https?:\/\//, { message: 'baseUrl 必须以 http:// 或 https:// 开头' })
    baseUrl!: string

    /** API 密钥（明文传入，落库后默认不回明文） */
    @IsString()
    @IsNotEmpty()
    @MaxLength(1024)
    apiKey!: string

    /** 模型名列表；可省略，默认空数组 */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(200)
    @IsString({ each: true })
    modelList?: string[]

    /** 是否设置为当前用户默认 Provider */
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean

    /** 设置为默认 Provider 时使用的默认模型 */
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    defaultModel?: string | null
}
