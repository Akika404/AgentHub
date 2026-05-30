-- =============================================================================
-- PlatformProvider 模块建表 SQL（按实体补全注释）
--
-- 来源实体：apps/server/src/platform-provider/entities/platform-provider.entity.ts
-- 由 TypeORM（synchronize/autoLoadEntities）自动建表，此文件仅作存档/参考，
-- 真实结构以实体定义为准。
--
-- 业务说明：用户自行接入的「模型平台/供应商」配置。每条记录归属某用户（userId），
-- 同一用户下 platformName 唯一。apiKey 必须可逆使用（用于调上游），无法哈希，明文存储但
-- 实体侧 select:false 默认不查出，对外仅回掩码，绝不回明文。
-- =============================================================================

-- --------------------------------------------------------
-- Table: platform_provider —— 用户自建模型平台/供应商
-- type 取值：openai-chat-completions / openai-responses / anthropic。
-- modelList 为 JSON 字符串数组；可空数组，亦可经「拉取模型」接口刷新覆盖。
-- --------------------------------------------------------

CREATE TABLE `platform_provider`
(
    `id`           varchar(36)   NOT NULL COMMENT '主键，UUID（应用层 PrimaryGeneratedColumn uuid 生成）',
    `userId`       varchar(36)   NOT NULL COMMENT '归属用户 id（逻辑外键到 user.id，无 DB 约束）；按它做数据隔离',
    `platformName` varchar(64)   NOT NULL COMMENT '平台展示名；同一用户下唯一',
    `type`         varchar(32)   NOT NULL COMMENT '接入协议类型：openai-chat-completions / openai-responses / anthropic',
    `baseUrl`      varchar(512)  NOT NULL COMMENT '上游 base url（如 https://api.openai.com/v1、https://api.anthropic.com）',
    `apiKey`       varchar(1024) NOT NULL COMMENT 'API 密钥；明文存储但实体侧 select:false 默认不查出，对外仅回掩码',
    `modelList`    json          NOT NULL COMMENT '模型名列表；JSON 字符串数组，可为空数组',
    `createdAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
    `updatedAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_platform_provider_user_name` (`userId`, `platformName`),
    KEY            `IDX_platform_provider_userId` (`userId`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='用户自建模型平台/供应商：接入配置与密钥（明文存储 select:false，对外仅回掩码）';
