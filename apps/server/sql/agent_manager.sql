-- =============================================================================
-- AgentManager 模块建表 SQL（从数据库导出后补全注释）
--
-- 来源实体：apps/server/src/mutiagents/entities/{agent-spec,agent-session}.entity.ts
-- 由 TypeORM（synchronize/autoLoadEntities）自动建表，此文件仅作存档/参考，
-- 真实结构以实体定义为准。
--
-- 三层模型见 doc/AgentManager设计文档.md：
--   AgentSpec（档案/配方，不变配置）─< AgentSession（会话句柄）  LiveAgent（进程内存，不入库）
-- =============================================================================

-- --------------------------------------------------------
-- Table: agent_spec —— 一个Agent的“档案”
-- 持久化重建一个 adapter 所需的不变配置，不含会话内容，且**不存 apiKey**
-- （密钥在重建时从 ConfigService/env 注入）。一份 spec 可被多个 session 复用。
-- --------------------------------------------------------

CREATE TABLE `agent_spec`
(
  `id`               varchar(36)   NOT NULL COMMENT '主键，UUID（应用层 PrimaryGeneratedColumn uuid 生成）',
  `vendor`           varchar(16)   NOT NULL COMMENT 'Agent 厂商：claude / codex',
  `model`            varchar(128)  NOT NULL COMMENT '模型名（如 claude-opus-4-8、gpt-5-codex 等）',
  `workingDirectory` varchar(1024) NOT NULL COMMENT '工作目录，agent 实际操作文件系统的根路径',
  `systemPrompt`     text COMMENT '系统提示词；可空。Claude 走 options.systemPrompt，Codex 不支持（创建时拦截而非静默丢弃）',
  `skills`           json                   DEFAULT NULL COMMENT '预加载技能；JSON，取值为字符串 "all" 或技能名数组；Codex 不支持',
  `mcpServers`       json                   DEFAULT NULL COMMENT 'MCP 服务器配置；JSON，形状对齐 Claude SDK 的 Record<string, McpServerConfig>',
  `allowedTools`     json                   DEFAULT NULL COMMENT '工具白名单；JSON 字符串数组；为空时由各 adapter 使用其默认集合',
  `permissionMode`   varchar(32)            DEFAULT NULL COMMENT '权限模式：default/acceptEdits/bypassPermissions/plan/dontAsk/auto；为空时 adapter 默认 bypassPermissions',
  `reasoningEffort`  varchar(16)            DEFAULT NULL COMMENT '推理 effort：minimal/low/medium/high/xhigh/max；由各 adapter 自行映射',
  `baseUrl`          varchar(512)           DEFAULT NULL COMMENT '自定义 base url，用于 Anthropic / OpenAI 兼容网关；为空走 SDK 默认',
  `createdAt`        datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
  `updatedAt`        datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
  PRIMARY KEY (`id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='Agent 档案/配方：重建 adapter 所需的不变配置（不含会话内容与 apiKey）';

-- --------------------------------------------------------
-- Table: agent_session —— 一次对话的“句柄”
-- 客户端用 id 与某个 agent 对话。会话内容由底层 SDK 落盘（Claude session 文件 /
-- Codex thread rollout），这里只持久化恢复所需的 sdkSessionId + 状态，
-- 因而能扛进程重启（恢复 = 用 spec 重建 adapter 并 resumeWith(sdkSessionId)）。
-- --------------------------------------------------------

CREATE TABLE `agent_session`
(
  `id`           varchar(36)  NOT NULL COMMENT '主键，UUID；客户端用它与 agent 对话',
  `specId`       varchar(255) NOT NULL COMMENT '关联的 agent_spec.id（逻辑外键，无 DB 约束）。注：实体声明为 uuid 但未指定长度，TypeORM 默认成 varchar(255)，实际存的是 36 位 UUID',
  `vendor`       varchar(16)  NOT NULL COMMENT '冗余的厂商字段（claude/codex），免去重建时为取 vendor 而 join agent_spec',
  `sdkSessionId` varchar(128)          DEFAULT NULL COMMENT '底层 SDK 会话 id（Claude session UUID / Codex thread id）；清空(clear)后置为 NULL，下次 send 自动开新会话',
  `status`       varchar(16)  NOT NULL DEFAULT 'active' COMMENT '会话状态：active 活跃 / suspended 已暂存（从内存驱逐，可恢复）/ cleared 已清空（句柄丢弃，下次开新会话）',
  `lastTurnAt`   datetime              DEFAULT NULL COMMENT '最近一轮对话完成时间；可空（尚未对话时为 NULL）',
  `createdAt`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
  `updatedAt`    datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
  PRIMARY KEY (`id`),
  KEY `IDX_ed66033a13eef462f4c1f1a5c9` (`specId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='Agent 会话句柄：持久化恢复所需的 vendor + specId + sdkSessionId + 状态，可扛进程重启';
