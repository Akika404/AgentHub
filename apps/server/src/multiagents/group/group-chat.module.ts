import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../../user/user.module.js'
import { UserWorkspaceModule } from '../../user-workspace/user-workspace.module.js'
import { PlatformProviderModule } from '../../platform-provider/platform-provider.module.js'
import { Agent } from '../entities/agent.entity.js'
import { AgentSession } from '../entities/agent-session.entity.js'
import { AgentMessage } from '../entities/agent-message.entity.js'
import { AgentMessageStep } from '../entities/agent-message-step.entity.js'
import { AgentPolicyService } from '../agents/agent-policy.service.js'
import { AgentWorkspaceService } from '../workspace/agent-workspace.service.js'
import { AgentMessageHistoryService } from '../messages/agent-message-history.service.js'
import { GroupChat } from './entities/group-chat.entity.js'
import { GroupChatMember } from './entities/group-chat-member.entity.js'
import { GroupMessage } from './entities/group-message.entity.js'
import { GroupRun } from './entities/group-run.entity.js'
import { BlackboardArtifactEntity } from './blackboard/entities/blackboard-artifact.entity.js'
import { BlackboardDecisionEntity } from './blackboard/entities/blackboard-decision.entity.js'
import { BlackboardContractEntity } from './blackboard/entities/blackboard-contract.entity.js'
import { BlackboardTaskEntity } from './blackboard/entities/blackboard-task.entity.js'
import { BlackboardEventEntity } from './blackboard/entities/blackboard-event.entity.js'
import { AgentMemoryItemEntity } from './memory/entities/agent-memory-item.entity.js'
import { GroupChatController } from './group-chat.controller.js'
import { GroupChatManager } from './group-chat.manager.js'
import { GroupChatService } from './group-chat.service.js'
import { GroupMessageService } from './group-message.service.js'
import { GroupArtifactPreviewService } from './group-artifact-preview.service.js'
import { GroupWorkspaceService } from './group-workspace.service.js'
import { DeploymentService } from './deployment/deployment.service.js'
import { LocalProcessRunner } from './deployment/local-process.runner.js'
import { DEPLOYMENT_RUNNER } from './deployment/deployment-runner.interface.js'
import { BlackboardService } from './blackboard/blackboard.service.js'
import { AgentMemoryService } from './memory/agent-memory.service.js'
import { ContextAssembler } from './context/context-assembler.service.js'
import { MessageRouter } from './routing/message-router.service.js'
import { ContinuityResolver } from './routing/continuity-resolver.service.js'
import { GroupRunStream } from './run/group-run-stream.service.js'
import { OrchestratorService } from './run/orchestrator.service.js'
import { DispatchService } from './run/dispatch.service.js'
import { MemberChatService } from './run/member-chat.service.js'
import { GroupRunExecutor } from './run/group-run.executor.js'
import { LlmOrchestratorPlanner, ORCHESTRATOR_PLANNER } from './run/orchestrator-planner.js'
import {
    LlmOrchestratorFinalReviewer,
    ORCHESTRATOR_FINAL_REVIEWER
} from './run/orchestrator-final-reviewer.js'
import {
    LlmOrchestratorHandoffReviewer,
    ORCHESTRATOR_HANDOFF_REVIEWER
} from './run/orchestrator-handoff-reviewer.js'
import { GroupDebugLogger } from './debug/group-debug-logger.service.js'

/**
 * GroupChatModule — 群聊协作（黑板 / Orchestrator / dispatch）。
 *
 * 与单聊同域（multiagents/group）。复用单聊的若干无状态服务（AgentPolicy /
 * AgentWorkspace / AgentMessageHistory）以及适配层 + Provider 凭证解析；turn 事件
 * 经 GroupRunStream 扇出（沿用 TurnStream 范式）。
 *
 * ORCHESTRATOR_PLANNER 默认绑定 LLM Planner：使用群聊配置的 vendor/model/provider
 * 和内置 prompt 生成真实编排计划。测试可覆盖该 token 注入假 Planner。
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            GroupChat,
            GroupChatMember,
            GroupMessage,
            GroupRun,
            BlackboardArtifactEntity,
            BlackboardDecisionEntity,
            BlackboardContractEntity,
            BlackboardTaskEntity,
            BlackboardEventEntity,
            AgentMemoryItemEntity,
            Agent,
            AgentSession,
            AgentMessage,
            AgentMessageStep
        ]),
        UserModule,
        UserWorkspaceModule,
        PlatformProviderModule
    ],
    controllers: [GroupChatController],
    providers: [
        GroupChatManager,
        GroupChatService,
        GroupMessageService,
        GroupArtifactPreviewService,
        GroupWorkspaceService,
        DeploymentService,
        LocalProcessRunner,
        { provide: DEPLOYMENT_RUNNER, useExisting: LocalProcessRunner },
        BlackboardService,
        AgentMemoryService,
        ContextAssembler,
        MessageRouter,
        ContinuityResolver,
        GroupRunStream,
        OrchestratorService,
        DispatchService,
        MemberChatService,
        GroupRunExecutor,
        LlmOrchestratorPlanner,
        LlmOrchestratorFinalReviewer,
        LlmOrchestratorHandoffReviewer,
        GroupDebugLogger,
        { provide: ORCHESTRATOR_PLANNER, useExisting: LlmOrchestratorPlanner },
        {
            provide: ORCHESTRATOR_FINAL_REVIEWER,
            useExisting: LlmOrchestratorFinalReviewer
        },
        {
            provide: ORCHESTRATOR_HANDOFF_REVIEWER,
            useExisting: LlmOrchestratorHandoffReviewer
        },
        // 复用单聊的无状态服务（按本模块的 repo 作用域重新提供）
        AgentPolicyService,
        AgentWorkspaceService,
        AgentMessageHistoryService
    ],
    exports: [GroupChatManager]
})
export class GroupChatModule {}
