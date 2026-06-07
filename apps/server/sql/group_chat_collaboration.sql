-- =============================================================================
-- 群聊协作模块建表 SQL（参考存档）
--
-- 来源实体：
--   apps/server/src/multiagents/group/entities/*.entity.ts
--   apps/server/src/multiagents/group/blackboard/entities/*.entity.ts
--   apps/server/src/multiagents/group/memory/entities/*.entity.ts
--
-- 由 TypeORM（synchronize/autoLoadEntities）自动建表，此文件仅作存档/参考，
-- 真实结构以实体定义为准。当前实体未声明 DB 外键，因此本 SQL 也不添加外键约束。
--
-- 业务说明：群聊协作最小闭环。一个群聊包含成员 Agent、展示层消息、一次次群运行、
-- 黑板（产出物 / 决策 / 契约 / 任务图 / 事件）以及 Agent 私有跨任务记忆。
-- =============================================================================

-- --------------------------------------------------------
-- Table: group_chat —— 群聊主体
-- 保存 Orchestrator 独立配置、共享 git 工作区、projectMeta。
-- activeRunId 不落库，由 Redis 活跃指针提供。
-- --------------------------------------------------------

CREATE TABLE `group_chat`
(
    `id`                     varchar(36)   NOT NULL COMMENT '主键，UUID',
    `userId`                 varchar(36)   NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）；按它做数据隔离',
    `title`                  varchar(128)  NOT NULL COMMENT '群聊标题',
    `status`                 varchar(16)   NOT NULL DEFAULT 'active' COMMENT '群聊状态：active / archived',
    `workspaceDir`           varchar(1024) NOT NULL COMMENT '共享 git 工作区根；产出物真相源与 worktree 基底',
    `orchestratorVendor`     varchar(16)   NOT NULL COMMENT 'Orchestrator 厂商：claude / codex',
    `orchestratorModel`      varchar(128)  NOT NULL COMMENT 'Orchestrator 使用的模型名',
    `orchestratorProviderId` varchar(36)   NOT NULL COMMENT 'Orchestrator 引用的 platform_provider.id',
    `orchestratorSessionId`  varchar(128)           DEFAULT NULL COMMENT 'Orchestrator SDK 会话 id；内部运行时字段，不暴露给前端',
    `projectName`            varchar(128)  NOT NULL COMMENT 'projectMeta.name',
    `projectGoal`            text                   DEFAULT NULL COMMENT 'projectMeta.goal；可空',
    `projectTechStack`       json                   DEFAULT NULL COMMENT 'projectMeta.techStack；JSON 字符串数组',
    `projectStatus`          varchar(16)   NOT NULL DEFAULT 'planning' COMMENT 'projectMeta.status：planning / designing / development / done',
    `createdAt`              datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `updatedAt`              datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `IDX_group_chat_userId` (`userId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='群聊主体：成员围绕黑板和共享 git 工作区协作，由独立 Orchestrator 编排';

-- --------------------------------------------------------
-- Table: group_chat_member —— 群成员
-- 关联用户已有 Agent；成员 AgentSession 在首次派发时懒创建。
-- --------------------------------------------------------

CREATE TABLE `group_chat_member`
(
    `id`             varchar(36) NOT NULL COMMENT '主键，UUID',
    `userId`         varchar(36) NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）',
    `groupChatId`    varchar(36) NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `agentId`        varchar(36) NOT NULL COMMENT '成员 Agent id（逻辑外键到 agent.id，无 DB 约束）',
    `roleInGroup`    varchar(64)          DEFAULT NULL COMMENT '成员在群内的自由文本能力标签，如 前端 / 后端；可空',
    `agentSessionId` varchar(36)          DEFAULT NULL COMMENT '该成员在本群复用的 AgentSession id；首次派发时懒创建',
    `joinedAt`       datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '加入时间',
    PRIMARY KEY (`id`),
    KEY `IDX_group_chat_member_userId` (`userId`),
    KEY `IDX_group_chat_member_groupChatId` (`groupChatId`),
    KEY `IDX_group_chat_member_agentId` (`agentId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='群成员：关联用户已有 Agent，并懒绑定群内复用 AgentSession';

-- --------------------------------------------------------
-- Table: group_message —— 群聊展示层消息（presentation_log）
-- 给人看 / 审计；与给 Agent 的结构化上下文解耦。
-- --------------------------------------------------------

CREATE TABLE `group_message`
(
    `id`            varchar(36) NOT NULL COMMENT '主键，UUID',
    `userId`        varchar(36) NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）',
    `groupChatId`   varchar(36) NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `kind`          varchar(16) NOT NULL COMMENT '消息卡片类型：text / system / task-list / options',
    `senderRole`    varchar(16) NOT NULL COMMENT '发送者角色：user / orchestrator / agent / system',
    `senderAgentId` varchar(36)          DEFAULT NULL COMMENT 'senderRole=agent 时为成员 Agent id，其余为 NULL',
    `text`          text                 DEFAULT NULL COMMENT 'text / system / options 的正文；task-list 通常为 NULL',
    `payload`       json                 DEFAULT NULL COMMENT '结构化负载：task-list 的 heading/tasks；options 的 options/answered 等',
    `createdAt`     datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `IDX_group_message_userId` (`userId`),
    KEY `IDX_group_message_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='群聊展示层消息 presentation_log：多发言者消息卡片与审计日志';

-- --------------------------------------------------------
-- Table: group_run —— 群运行元信息
-- 一条用户消息触发一次群运行；实际围观事件在 Redis Stream。
-- --------------------------------------------------------

CREATE TABLE `group_run`
(
    `id`          varchar(36) NOT NULL COMMENT '主键，UUID；一次群运行 id',
    `userId`      varchar(36) NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）',
    `groupChatId` varchar(36) NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `status`      varchar(16) NOT NULL DEFAULT 'running' COMMENT '运行状态：running / done / failed / aborted',
    `routeKind`   varchar(16) NOT NULL COMMENT '路由类型：direct_single / multi / orchestrate',
    `userText`    text                 DEFAULT NULL COMMENT '触发本轮的用户消息原文',
    `createdAt`   datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `endedAt`     datetime             DEFAULT NULL COMMENT '结束时间；运行中为 NULL',
    PRIMARY KEY (`id`),
    KEY `IDX_group_run_userId` (`userId`),
    KEY `IDX_group_run_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='群运行元信息：一次用户消息触发的 Orchestrator + 成员 turn 编排';

-- --------------------------------------------------------
-- Table: blackboard_artifact —— 黑板产出物
-- 产出物即真相源；同一群聊内 path 唯一，version 为乐观锁基准。
-- --------------------------------------------------------

CREATE TABLE `blackboard_artifact`
(
    `id`               varchar(36)   NOT NULL COMMENT '主键，UUID',
    `groupChatId`      varchar(36)   NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `type`             varchar(16)   NOT NULL COMMENT '产出物类型：code / document / design / test_report',
    `path`             varchar(512)  NOT NULL COMMENT '共享工作区内相对路径；群内唯一（参与唯一索引，长度需避开 MySQL utf8mb4 索引上限）',
    `ownerAgentId`     varchar(36)   NOT NULL COMMENT '产出物 owner Agent id',
    `version`          int           NOT NULL DEFAULT 1 COMMENT '乐观锁版本；每次写入 +1',
    `status`           varchar(16)   NOT NULL DEFAULT 'draft' COMMENT '状态：draft / proposed / approved / deprecated',
    `summary`          text          NOT NULL COMMENT '产出物摘要；注入上下文时默认注摘要，不注全文',
    `updatedByAgentId` varchar(36)   NOT NULL COMMENT '最近更新该产出物的 Agent id',
    `createdAt`        datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `updatedAt`        datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_blackboard_artifact_group_path` (`groupChatId`, `path`),
    KEY `IDX_blackboard_artifact_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='黑板产出物索引：路径唯一、version 乐观锁、summary 供上下文装配';

-- --------------------------------------------------------
-- Table: blackboard_decision —— 黑板决策
-- 写新决策时可 supersede 旧决策，避免新旧决策并存。
-- --------------------------------------------------------

CREATE TABLE `blackboard_decision`
(
    `id`               varchar(36)  NOT NULL COMMENT '主键，UUID',
    `groupChatId`      varchar(36)  NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `content`          text         NOT NULL COMMENT '决策内容',
    `rationale`        text                  DEFAULT NULL COMMENT '决策理由；可空',
    `status`           varchar(16)  NOT NULL DEFAULT 'proposed' COMMENT '状态：proposed / approved / superseded / rejected',
    `scope`            varchar(128)          DEFAULT NULL COMMENT '决策作用域；可空',
    `supersedes`       json                  DEFAULT NULL COMMENT '取代的旧决策 id 列表；JSON 字符串数组',
    `createdByAgentId` varchar(36)  NOT NULL COMMENT '创建该决策的 Agent id',
    `approvedBy`       varchar(64)           DEFAULT NULL COMMENT '批准者：orchestrator / agentId / userId；未批准为 NULL',
    `createdAt`        datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `IDX_blackboard_decision_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='黑板决策：带 status、rationale、supersedes 的协作事实';

-- --------------------------------------------------------
-- Table: blackboard_contract —— 黑板共享契约
-- contractKey 是群内稳定业务 id；非 owner 修改 approvalRequired 契约会被拒绝。
-- --------------------------------------------------------

CREATE TABLE `blackboard_contract`
(
    `id`               varchar(36)  NOT NULL COMMENT '主键，UUID',
    `groupChatId`      varchar(36)  NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `contractKey`      varchar(128) NOT NULL COMMENT '群内稳定业务 id，如 time_api；对外视图 id 即它',
    `spec`             json         NOT NULL COMMENT '契约结构化字段，如 endpoint / returns 等',
    `ownerAgentId`     varchar(36)  NOT NULL COMMENT '契约 owner Agent id',
    `consumers`        json                  DEFAULT NULL COMMENT '消费该契约的 Agent id 列表；JSON 字符串数组',
    `approvalRequired` tinyint      NOT NULL DEFAULT 0 COMMENT '是否需要 owner 审批；1=true / 0=false',
    `version`          int          NOT NULL DEFAULT 1 COMMENT '契约版本；每次写入 +1',
    `createdAt`        datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `updatedAt`        datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_blackboard_contract_group_key` (`groupChatId`, `contractKey`),
    KEY `IDX_blackboard_contract_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='黑板共享契约：群内稳定 contractKey、owner 保护、version 版本';

-- --------------------------------------------------------
-- Table: blackboard_task —— 黑板任务图节点
-- Orchestrator 拆解后写入；本 MVP 串行执行，seq 保证展示/执行顺序。
-- --------------------------------------------------------

CREATE TABLE `blackboard_task`
(
    `id`          varchar(36)  NOT NULL COMMENT '主键，UUID',
    `groupChatId` varchar(36)  NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `runId`       varchar(36)           DEFAULT NULL COMMENT '产生该任务的 group_run.id；可空',
    `name`        varchar(256) NOT NULL COMMENT '任务名称',
    `agentId`     varchar(36)           DEFAULT NULL COMMENT '被指派的成员 Agent id；未指派为 NULL',
    `deps`        json                  DEFAULT NULL COMMENT '依赖任务 id 列表；JSON 字符串数组',
    `status`      varchar(16)  NOT NULL DEFAULT 'pending' COMMENT '任务状态：pending / ready / doing / done / failed',
    `objective`   text         NOT NULL COMMENT '任务目标，传给成员 Agent 的核心指令',
    `seq`         int          NOT NULL DEFAULT 0 COMMENT '稳定展示/执行顺序',
    `createdAt`   datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `updatedAt`   datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `IDX_blackboard_task_groupChatId` (`groupChatId`),
    KEY `IDX_blackboard_task_runId` (`runId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='黑板任务图节点：Orchestrator 拆解出的 task_graph';

-- --------------------------------------------------------
-- Table: blackboard_event —— 黑板事件
-- append-only 审计/调试流；运行围观时也会转成 blackboard_update 事件。
-- --------------------------------------------------------

CREATE TABLE `blackboard_event`
(
    `id`           varchar(36)  NOT NULL COMMENT '主键，UUID',
    `groupChatId`  varchar(36)  NOT NULL COMMENT '所属群聊 id（逻辑外键到 group_chat.id，无 DB 约束）',
    `kind`         varchar(16)  NOT NULL COMMENT '黑板对象类型：artifact / decision / contract / task',
    `targetId`     varchar(128) NOT NULL COMMENT '受影响黑板对象 id',
    `op`           varchar(16)  NOT NULL COMMENT '操作：created / updated / superseded / rejected',
    `summary`      text         NOT NULL COMMENT '事件摘要',
    `actorAgentId` varchar(36)           DEFAULT NULL COMMENT '引发变更的 Agent id；系统/Orchestrator 驱动为 NULL',
    `createdAt`    datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    PRIMARY KEY (`id`),
    KEY `IDX_blackboard_event_groupChatId` (`groupChatId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='黑板事件：append-only 的事实变更审计/调试流';

-- --------------------------------------------------------
-- Table: agent_memory_item —— Agent 私有跨任务记忆
-- scopeProject 当前等于 groupChatId；ContextAssembler 检索并丢弃与黑板冲突的记忆。
-- --------------------------------------------------------

CREATE TABLE `agent_memory_item`
(
    `id`           varchar(36)  NOT NULL COMMENT '主键，UUID',
    `userId`       varchar(36)  NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）',
    `agentId`      varchar(36)  NOT NULL COMMENT '所属 Agent id（逻辑外键到 agent.id，无 DB 约束）',
    `scopeProject` varchar(64)  NOT NULL COMMENT '记忆作用域 project；当前等于群聊 id，避免跨项目污染',
    `scopeModule`  varchar(128)          DEFAULT NULL COMMENT '记忆作用域 module；可空表示项目通用',
    `content`      text         NOT NULL COMMENT '记忆内容',
    `type`         varchar(32)  NOT NULL COMMENT '记忆类型：convention / project_knowledge / lesson / work_done',
    `sourceType`   varchar(16)  NOT NULL COMMENT '来源类型：blackboard / self_summary / user',
    `sourceRef`    varchar(256)          DEFAULT NULL COMMENT '来源引用 id / key；可空',
    `status`       varchar(16)  NOT NULL DEFAULT 'active' COMMENT '状态：active / stale / deprecated',
    `createdAt`    datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间',
    `lastUsedAt`   datetime             DEFAULT NULL COMMENT '最近使用时间；未使用为 NULL',
    PRIMARY KEY (`id`),
    KEY `IDX_agent_memory_item_userId` (`userId`),
    KEY `IDX_agent_memory_item_agentId` (`agentId`),
    KEY `IDX_agent_memory_item_scopeProject` (`scopeProject`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='Agent 私有跨任务记忆：带 scope/source/status，辅助上下文装配';
