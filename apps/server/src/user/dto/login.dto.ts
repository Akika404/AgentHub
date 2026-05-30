import { IsNotEmpty, IsString } from 'class-validator'

/** 登录入参：account + password。 */
export class LoginDto {
    @IsString()
    @IsNotEmpty()
    account!: string

    @IsString()
    @IsNotEmpty()
    password!: string
}
