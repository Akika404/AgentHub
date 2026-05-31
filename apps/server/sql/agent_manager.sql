-- =============================================================================
-- AgentManager 模块建表 SQL（从数据库导出后补全注释）
--
-- 来源实体：apps/server/src/mutiagents/entities/{agent,agent-session}.entity.ts
-- 由 TypeORM（synchronize/autoLoadEntities）自动建表，此文件仅作存档/参考，
-- 真实结构以实体定义为准。
--
-- 三层模型见 doc/agent-manager-spec.md：
--   Agent（用户拥有的配置）─< AgentSession（会话句柄）  LiveAgent（进程内存，不入库）
-- 关键设计：
--   * Agent 归属用户（userId），按它做数据隔离；
--   * 不存 baseUrl / apiKey —— 运行时按 platformProviderId 从 platform_provider 取；
--   * Agent 与会话解耦：创建 Agent 不开会话，单聊按 agentId 懒加载/复用一条 agent_session。
-- =============================================================================

-- --------------------------------------------------------
-- Table: agent —— 用户创建的一个虚拟员工（持久化配置）
-- 归属某个用户（userId），进入该用户的 AgentList。配置在创建时即确定：
-- vendor、引用的 Provider（platformProviderId）+ 选定 model、工作目录、systemPrompt、
-- skills、mcp、tools 等。**不存 apiKey / baseUrl**（运行时从所引用 Provider 取）。
-- 一个 Agent 可被多个会话复用。
-- --------------------------------------------------------

CREATE TABLE `agent`
(
  `id`                 varchar(36)   NOT NULL COMMENT '主键，UUID（应用层 PrimaryGeneratedColumn uuid 生成）',
  `userId`             varchar(36)   NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）；按它做数据隔离',
  `name`               varchar(64)   NOT NULL COMMENT '展示名，用于在 AgentList / 群聊里区分多个 Agent（同一用户下不强制唯一）',
  `vendor`             varchar(16)   NOT NULL COMMENT 'Agent 厂商：claude / codex；决定用哪个 Agent SDK 驱动',
  `platformProviderId` varchar(36)   NOT NULL COMMENT '引用的模型平台 id（逻辑外键到 platform_provider.id）；运行时据此取 baseUrl + apiKey',
  `model`              varchar(128)  NOT NULL COMMENT '选定的模型名，取自所引用 Provider 的 modelList',
  `workingDirectory`   varchar(1024) NOT NULL COMMENT '工作目录，agent 实际操作文件系统的根路径',
  `systemPrompt`       text COMMENT '系统提示词；可空。Claude 走 options.systemPrompt，Codex 不支持（创建时拦截而非静默丢弃）',
  `skills`             json                   DEFAULT NULL COMMENT '预加载技能；JSON，取值为字符串 "all" 或技能名数组；Codex 不支持',
  `mcpServers`         json                   DEFAULT NULL COMMENT 'MCP 服务器配置；JSON，形状对齐 Claude SDK 的 Record<string, McpServerConfig>',
  `allowedTools`       json                   DEFAULT NULL COMMENT '工具白名单；JSON 字符串数组；为空时由各 adapter 使用其默认集合',
  `permissionMode`     varchar(32)            DEFAULT NULL COMMENT '权限模式：default/acceptEdits/bypassPermissions/plan/dontAsk/auto；为空时 adapter 默认 bypassPermissions',
  `reasoningEffort`    varchar(16)            DEFAULT NULL COMMENT '推理 effort：minimal/low/medium/high/xhigh/max；由各 adapter 自行映射',
  `createdAt`          datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
  `updatedAt`          datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
  PRIMARY KEY (`id`),
  KEY `IDX_agent_userId` (`userId`),
  KEY `IDX_agent_platformProviderId` (`platformProviderId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='用户虚拟员工：归属用户的不变配置（不含会话内容、apiKey、baseUrl）';

-- --------------------------------------------------------
-- Table: agent_session —— 一次对话的“句柄”
-- 通过其 Agent（agentId）与之对话；本期为「单聊」语义：每个 Agent 懒加载/复用一条会话。
-- 会话内容由底层 SDK 落盘（Claude session 文件 / Codex thread rollout），这里只持久化恢复所需的
-- sdkSessionId + 状态，因而能扛进程重启（恢复 = 用 Agent 配置重建 adapter 并 resumeWith(sdkSessionId)）。
-- --------------------------------------------------------

CREATE TABLE `agent_session`
(
  `id`           varchar(36)  NOT NULL COMMENT '主键，UUID',
  `userId`       varchar(36)  NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id）；冗余存储，免 join 即可做数据隔离',
  `agentId`      varchar(36)  NOT NULL COMMENT '关联的 agent.id（逻辑外键，无 DB 约束）',
  `vendor`       varchar(16)  NOT NULL COMMENT '冗余的厂商字段（claude/codex），免去重建时为取 vendor 而 join agent',
  `sdkSessionId` varchar(128)          DEFAULT NULL COMMENT '底层 SDK 会话 id（Claude session UUID / Codex thread id）；清空(clear)后置为 NULL，下次 send 自动开新会话',
  `status`       varchar(16)  NOT NULL DEFAULT 'active' COMMENT '会话状态：active 活跃 / suspended 已暂存（从内存驱逐，可恢复）/ cleared 已清空（句柄丢弃，下次开新会话）',
  `lastTurnAt`   datetime              DEFAULT NULL COMMENT '最近一轮对话完成时间；可空（尚未对话时为 NULL）',
  `createdAt`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
  `updatedAt`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
  PRIMARY KEY (`id`),
  KEY `IDX_agent_session_userId` (`userId`),
  KEY `IDX_agent_session_agentId` (`agentId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='Agent 会话句柄：持久化恢复所需的 userId + agentId + vendor + sdkSessionId + 状态，可扛进程重启';
