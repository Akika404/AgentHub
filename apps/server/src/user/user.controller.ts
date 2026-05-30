import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiEnvelope } from '../common/swagger/api-envelope.decorator.js'
import { UserService } from './user.service.js'
import { RegisterDto } from './dto/register.dto.js'
import { LoginDto } from './dto/login.dto.js'
import type { LoginResult, UserView } from './dto/user-view.dto.js'
import {
    DeactivateResultDto,
    LoginResultDto,
    LogoutResultDto,
    UserViewDto
} from './dto/user-response.dto.js'
import { JwtAuthGuard } from './auth/jwt-auth.guard.js'
import { AuthPayload, CurrentUser } from './auth/current-user.decorator.js'
import type { JwtPayload } from './auth/auth.types.js'
import type { User } from './entities/user.entity.js'

@ApiTags('user')
@Controller('user')
export class UserController {
    constructor(private readonly userService: UserService) {}

    @Post('register')
    @ApiOperation({ summary: '注册', description: '用户名 + 密码注册；注册不自动登录' })
    @ApiEnvelope(UserViewDto, { status: 201 })
    register(@Body() dto: RegisterDto): Promise<UserView> {
        return this.userService.register(dto)
    }

    @Post('login')
    @ApiOperation({ summary: '登录', description: '校验账号密码，返回 JWT token 与用户视图' })
    @ApiEnvelope(LoginResultDto, { status: 201 })
    login(@Body() dto: LoginDto): Promise<LoginResult> {
        return this.userService.login(dto)
    }

    @Post('logout')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: '退出登录', description: '当前 token 加入黑名单，服务端即时失效' })
    @ApiEnvelope(LogoutResultDto, { status: 201 })
    logout(@AuthPayload() payload: JwtPayload): Promise<{ success: true }> {
        return this.userService.logout(payload)
    }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: '获取当前用户信息' })
    @ApiEnvelope(UserViewDto)
    me(@CurrentUser() user: User): UserView {
        return this.userService.getMe(user)
    }

    @Delete('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: '注销账号（逻辑删除）',
        description: 'status 置 deactivated，账号不可再登录，并即时吊销当前 token'
    })
    @ApiEnvelope(DeactivateResultDto)
    deactivate(
        @CurrentUser() user: User,
        @AuthPayload() payload: JwtPayload
    ): Promise<{ deactivated: true }> {
        return this.userService.deactivate(user, payload)
    }
}
