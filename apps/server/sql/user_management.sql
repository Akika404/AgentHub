-- =============================================================================
-- 用户管理模块建表 SQL（按实体补全注释）
--
-- 来源实体：apps/server/src/user/entities/user.entity.ts
-- 由 TypeORM（synchronize/autoLoadEntities）自动建表，此文件仅作存档/参考，
-- 真实结构以实体定义为准。
--
-- 鉴权基座说明：登录态为无状态 JWT，token 黑名单（退出登录/注销）存于 Redis，
-- 均不入库，因此本模块只有 user 一张表。
-- =============================================================================

-- --------------------------------------------------------
-- Table: user —— 平台用户
-- account 为登录名（唯一不可变）；nickname/email/avatar 为注册后可选补充资料。
-- 密码只存 bcrypt 哈希（passwordHash），实体侧 select:false 默认不查出。
-- 注销为逻辑删除：status 置 deactivated，记录保留，account/email 仍占用唯一索引。
-- --------------------------------------------------------

CREATE TABLE `user`
(
    `id`           varchar(36)  NOT NULL COMMENT '主键，UUID（应用层 PrimaryGeneratedColumn uuid 生成）',
    `account`      varchar(64)  NOT NULL COMMENT '登录名，唯一不可变',
    `passwordHash` varchar(100) NOT NULL COMMENT 'bcrypt 哈希，绝不存明文；实体侧 select:false 默认不随查询返回',
    `nickname`     varchar(64)           DEFAULT NULL COMMENT '展示名；可空',
    `email`        varchar(255)          DEFAULT NULL COMMENT '邮箱；可空且唯一（MySQL 唯一索引允许多个 NULL）',
    `avatar`       mediumtext            DEFAULT NULL COMMENT '头像 URL 或压缩后的 data URL；可空',
    `status`       varchar(16)  NOT NULL DEFAULT 'active' COMMENT '用户状态：active 活跃 / deactivated 已注销（逻辑删除，不可再登录）',
    `createdAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '创建时间（@CreateDateColumn，微秒精度）',
    `updatedAt`    datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT '更新时间（@UpdateDateColumn，行更新时自动刷新）',
    PRIMARY KEY (`id`),
    UNIQUE KEY `UQ_user_account` (`account`),
    UNIQUE KEY `UQ_user_email` (`email`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci COMMENT ='平台用户：账号密码、资料与状态；密码仅存 bcrypt 哈希，注销为 status 逻辑删除';
