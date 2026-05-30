import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator'

/**
 * 注册入参：仅 account + password。
 *
 * nickname / email / avatar 为注册后可选补充的资料，不在注册时收集。
 */
export class RegisterDto {
    /** 登录名：4-64 位，字母/数字/下划线/连字符 */
    @IsString()
    @IsNotEmpty()
    @MinLength(4)
    @MaxLength(64)
    @Matches(/^[a-zA-Z0-9_-]+$/, {
        message: 'account 只能包含字母、数字、下划线或连字符'
    })
    account!: string

    /** 密码：6-64 位（仅长度约束，哈希后存储） */
    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    @MaxLength(64)
    password!: string
}
