import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../user/user.module.js'
import { UserWorkspaceModule } from '../user-workspace/user-workspace.module.js'
import { PlatformProviderModule } from '../platform-provider/platform-provider.module.js'
import { AgentChatsController } from './agent-chats.controller.js'
import { AgentsController } from './agents.controller.js'
import { AgentManager } from './agent-manager.service.js'
import { AgentConfigService } from './agents/agent-config.service.js'
import { AgentPolicyService } from './agents/agent-policy.service.js'
import { AgentChatService } from './chats/agent-chat.service.js'
import { AgentMessageHistoryService } from './messages/agent-message-history.service.js'
import { AgentRuntimeService } from './runtime/agent-runtime.service.js'
import { TurnStream } from './runtime/turn-stream.service.js'
import { AgentWorkspaceService } from './workspace/agent-workspace.service.js'
import { WorkspaceDiffService } from './workspace/workspace-diff.service.js'
import { Agent } from './entities/agent.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'
import { AgentMessage } from './entities/agent-message.entity.js'
import { AgentMessageStep } from './entities/agent-message-step.entity.js'
import { GroupChatMember } from './group/entities/group-chat-member.entity.js'

/**
 * AgentsModule — 用户虚拟员工管理。
 *
 * 注册 Agent / AgentSession / AgentMessage / AgentMessageStep 四个实体
 * （autoLoadEntities 已开，forFeature 即建表）；
 * 导入 UserModule 复用其导出的 JwtAuthGuard（控制器整体鉴权）；
 * 导入 PlatformProviderModule 以按 platformProviderId 取运行时凭证（resolveRuntimeConfig）。
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            Agent,
            AgentSession,
            AgentMessage,
            AgentMessageStep,
            GroupChatMember
        ]),
        UserModule,
        UserWorkspaceModule,
        PlatformProviderModule
    ],
    controllers: [AgentsController, AgentChatsController],
    providers: [
        AgentManager,
        AgentConfigService,
        AgentChatService,
        AgentPolicyService,
        AgentWorkspaceService,
        WorkspaceDiffService,
        AgentMessageHistoryService,
        AgentRuntimeService,
        TurnStream
    ],
    exports: [AgentManager]
})
export class AgentsModule {}
