import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../user/user.module.js'
import { PlatformProviderModule } from '../platform-provider/platform-provider.module.js'
import { AgentChatsController } from './agent-chats.controller.js'
import { AgentsController } from './agents.controller.js'
import { AgentManager } from './agent-manager.service.js'
import { Agent } from './entities/agent.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'
import { AgentMessage } from './entities/agent-message.entity.js'

/**
 * AgentsModule — 用户虚拟员工管理（AgentManager）。
 *
 * 注册 Agent / AgentSession / AgentMessage 三个实体（autoLoadEntities 已开，forFeature 即建表）；
 * 导入 UserModule 复用其导出的 JwtAuthGuard（控制器整体鉴权）；
 * 导入 PlatformProviderModule 以按 platformProviderId 取运行时凭证（resolveRuntimeConfig）。
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([Agent, AgentSession, AgentMessage]),
        UserModule,
        PlatformProviderModule
    ],
    controllers: [AgentsController, AgentChatsController],
    providers: [AgentManager],
    exports: [AgentManager]
})
export class AgentsModule {}
