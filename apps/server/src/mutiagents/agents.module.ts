import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AgentsController } from './agents.controller.js'
import { AgentManager } from './agent-manager.service.js'
import { AgentSpec } from './entities/agent-spec.entity.js'
import { AgentSession } from './entities/agent-session.entity.js'

/**
 * AgentsModule — 多 Agent 管理（AgentManager）。
 *
 * 注册 AgentSpec / AgentSession 两个实体；autoLoadEntities 已开，forFeature 即建表。
 */
@Module({
  imports: [TypeOrmModule.forFeature([AgentSpec, AgentSession])],
  controllers: [AgentsController],
  providers: [AgentManager],
  exports: [AgentManager],
})
export class AgentsModule {}
