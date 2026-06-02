import { IsOptional, IsString, MaxLength } from 'class-validator'

const AVATAR_MAX_LENGTH = 256 * 1024 // 256 KiB compact data URL

/**
 * 更新当前用户资料的入参（部分更新）。
 *
 * 只更新传入的字段：字段省略（undefined）则保留原值，显式传 null 则清空该字段。
 * account 登录名不可变、password 走独立接口，均不在此收集。
 * 全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted，未声明字段会被拒绝。
 */
export class UpdateUserDto {
    /** 展示名；传 null 清空 */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    nickname?: string | null

    /** 头像 URL / 压缩后的 data URL；传 null 清空 */
    @IsOptional()
    @IsString()
    @MaxLength(AVATAR_MAX_LENGTH)
    avatar?: string | null
}
