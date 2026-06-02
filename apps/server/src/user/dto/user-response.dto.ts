import { ApiProperty } from '@nestjs/swagger'
import type { UserStatus } from '../entities/user.entity.js'
import type { LoginResult, UserView } from './user-view.dto.js'

const STATUSES: UserStatus[] = ['active', 'deactivated']

/**
 * 响应侧 DTO（Swagger 文档模型）。
 *
 * user-view.dto.ts 里的 UserView / LoginResult 是 interface，编译后被擦除、运行时无
 * 元数据，Swagger 无法据其生成 schema。这里用 class 镜像同一形状并 `implements` 对应
 * interface —— 字段一旦与契约不符即编译报错，因此 interface 仍是唯一契约，本文件只为出文档。
 */
export class UserViewDto implements UserView {
    @ApiProperty({ description: '用户 id' })
    id!: string

    @ApiProperty({ description: '登录名（唯一不可变）' })
    account!: string

    @ApiProperty({ type: String, nullable: true, description: '展示名' })
    nickname!: string | null

    @ApiProperty({ type: String, nullable: true, description: '邮箱' })
    email!: string | null

    @ApiProperty({ type: String, nullable: true, description: '头像 URL / 压缩后的 data URL' })
    avatar!: string | null

    @ApiProperty({ enum: STATUSES, description: '用户状态' })
    status!: UserStatus

    @ApiProperty({ description: '创建时间，ISO8601' })
    createdAt!: string
}

/** 登录成功后的返回 */
export class LoginResultDto implements LoginResult {
    @ApiProperty({ description: 'JWT access token，放 Authorization: Bearer 使用' })
    token!: string

    @ApiProperty({ description: 'token 有效期（秒）' })
    expiresIn!: number

    @ApiProperty({ type: UserViewDto, description: '登录用户视图' })
    user!: UserView
}

/** 退出登录的返回 */
export class LogoutResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已退出' })
    success!: true
}

/** 注销账号的返回 */
export class DeactivateResultDto {
    @ApiProperty({ enum: [true], example: true, description: '恒为 true，表示已注销' })
    deactivated!: true
}
