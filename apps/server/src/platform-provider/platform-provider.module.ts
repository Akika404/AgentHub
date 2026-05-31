import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../user/user.module.js'
import { PlatformProviderController } from './platform-provider.controller.js'
import { PlatformProviderService } from './platform-provider.service.js'
import { ProviderProbeService } from './provider-probe.service.js'
import { PlatformProvider } from './entities/platform-provider.entity.js'

/**
 * PlatformProviderModule —— 用户自建模型平台（Provider）管理。
 *
 * 注册 PlatformProvider 实体（autoLoadEntities 已开，forFeature 即建表）；
 * 导入 UserModule 以复用其导出的 JwtAuthGuard（控制器整体鉴权）。
 * 导出 PlatformProviderService 供 AgentsModule 取运行时凭证（resolveRuntimeConfig）。
 */
@Module({
    imports: [TypeOrmModule.forFeature([PlatformProvider]), UserModule],
    controllers: [PlatformProviderController],
    providers: [PlatformProviderService, ProviderProbeService],
    exports: [PlatformProviderService]
})
export class PlatformProviderModule {}
