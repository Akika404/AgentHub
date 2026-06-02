-- =============================================================================
-- AgentManager 模块建表 SQL（参考存档）
--
-- 真实结构以 apps/server/src/mutiagents/entities/*.entity.ts 为准。
-- 当前模型：
--   Agent（用户拥有的可复用配置）
--   AgentSession（一个单 Agent 聊天会话）
--   AgentMessage（按 sessionId 隔离的 UI 消息历史）
-- =============================================================================

CREATE TABLE `agent`
(
  `id`                 varchar(36)   NOT NULL COMMENT '主键，UUID',
  `userId`             varchar(36)   NOT NULL COMMENT '归属用户 id',
  `name`               varchar(64)   NOT NULL COMMENT '展示名',
  `vendor`             varchar(16)   NOT NULL COMMENT 'claude / codex',
  `platformProviderId` varchar(36)   NOT NULL COMMENT '引用 platform_provider.id',
  `model`              varchar(128)  NOT NULL COMMENT '模型名',
  `agentHomeDirectory` varchar(1024) NOT NULL COMMENT 'Agent 私有持久目录',
  `workingDirectory`   varchar(1024) NOT NULL COMMENT 'Agent 默认工作目录',
  `systemPrompt`       text                   DEFAULT NULL COMMENT 'Agent 级 system prompt',
  `skills`             json                   DEFAULT NULL COMMENT '"all" 或 skill 名称数组',
  `mcpServers`         json                   DEFAULT NULL COMMENT 'Agent 级 MCP servers',
  `allowedTools`       json                   DEFAULT NULL COMMENT '工具白名单',
  `permissionMode`     varchar(32)            DEFAULT NULL COMMENT '权限模式',
  `reasoningEffort`    varchar(16)            DEFAULT NULL COMMENT '推理 effort',
  `createdAt`          datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt`          datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_agent_userId` (`userId`),
  KEY `IDX_agent_platformProviderId` (`platformProviderId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='用户虚拟员工配置';

CREATE TABLE `agent_session`
(
  `id`                   varchar(36)   NOT NULL COMMENT '聊天/会话 id，UUID',
  `userId`               varchar(36)   NOT NULL COMMENT '归属用户 id',
  `agentId`              varchar(36)   NOT NULL COMMENT '关联 agent.id',
  `vendor`               varchar(16)   NOT NULL COMMENT '冗余厂商字段',
  `title`                varchar(128)           DEFAULT NULL COMMENT '可选聊天标题',
  `workingDirectory`     varchar(1024) NOT NULL COMMENT '本聊天工作目录',
  `sessionHomeDirectory` varchar(1024) NOT NULL COMMENT '本聊天私有 home',
  `skills`               json                   DEFAULT NULL COMMENT '合并后的有效 skills',
  `mcpServers`           json                   DEFAULT NULL COMMENT '合并后的有效 MCP servers',
  `sdkSessionId`         varchar(128)           DEFAULT NULL COMMENT '底层 SDK 会话 id',
  `status`               varchar(16)   NOT NULL DEFAULT 'active' COMMENT 'active / suspended / cleared',
  `lastTurnAt`           datetime               DEFAULT NULL COMMENT '最近一轮对话完成时间',
  `createdAt`            datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt`            datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_agent_session_userId` (`userId`),
  KEY `IDX_agent_session_agentId` (`agentId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='单 Agent 聊天会话';

CREATE TABLE `agent_message`
(
  `id`        varchar(36) NOT NULL COMMENT '主键，UUID',
  `userId`    varchar(36) NOT NULL COMMENT '归属用户 id',
  `agentId`   varchar(36) NOT NULL COMMENT '关联 agent.id',
  `sessionId` varchar(36) NOT NULL COMMENT '关联 agent_session.id',
  `role`      varchar(16) NOT NULL COMMENT 'user / agent / system',
  `text`      text        NOT NULL COMMENT '主聊天区可见文本',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_agent_message_userId` (`userId`),
  KEY `IDX_agent_message_agentId` (`agentId`),
  KEY `IDX_agent_message_sessionId` (`sessionId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='单 Agent 聊天 UI 消息历史';
