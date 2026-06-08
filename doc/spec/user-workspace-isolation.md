# 用户文件工作区隔离

> 后端用户文件系统隔离模块，涉及 `apps/server/src/user-workspace/`、`workspace-fs`、Agent、单聊、群聊工作区创建链路。

## Context

AgentHub 后端会运行在服务器上，数据库记录已经按 `userId` 隔离，但当前文件系统路径仍由客户端传入服务器绝对路径，并通过全局 roots 浏览。这会导致多个用户可能选择、创建或导入同一批服务器目录。

本功能新增用户专属文件空间：服务端从 `AGENTHUB_USER_SPACE_ROOT` 读取总根目录，为每个用户创建 `<root>/<userId>/`，并在其下划分 `skills`、`session`、`agent_home`、`agent_workspace`。所有 Agent Home、会话 home、单聊/群聊工作区和 skill 来源目录都必须位于当前用户自己的对应目录内。

## Model

不新增数据库实体。新增运行时目录模型：

- `AGENTHUB_USER_SPACE_ROOT`：服务器用户空间总根，未配置时默认 `~/.agenthub/users`。
- `<root>/<userId>/skills`：当前用户可导入的 skill 来源目录。
- `<root>/<userId>/session`：当前用户 Agent 单聊/群聊成员 session home 目录。
- `<root>/<userId>/agent_home`：当前用户 Agent 私有 home 可选范围。
- `<root>/<userId>/agent_workspace`：当前用户单聊/群聊工作区可选范围。

共享类型 `ServerDirectoryRoot` 增加可选 `kind` 字段：`skills | agent_home | agent_workspace`，用于前端区分目录选择用途。

## Backend API

现有 API 形状保持不变，但路径策略变为按当前登录用户过滤。

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/workspace-fs/roots` | 返回当前用户可浏览的 `skills` / `agent_home` / `agent_workspace` roots |
| `GET` | `/workspace-fs/directories?path=<absolute path>` | 仅允许列出当前用户 roots 内目录 |
| `POST` | `/agents` | 创建 Agent 时校验 home/workspace/skill 来源都属于当前用户 |
| `PATCH` | `/agents/:agentId` | 更新 Agent 时校验 workspace/skill 来源都属于当前用户 |
| `POST` | `/agent-chats` | 创建单聊时校验或自动分配用户工作区与 session home |
| `POST` | `/group-chats` | 创建群聊时校验或自动分配用户群聊工作区 |

## Runtime Flow

1. 任意需要用户文件空间的接口先通过 `UserWorkspaceService.ensureUserWorkspace(userId)` 创建并解析当前用户四类目录。
2. `workspace-fs` 只返回当前用户 roots；列目录时会解析真实路径并确认仍位于当前用户 roots 内。
3. 创建 Agent：
   - `workingDirectory` 必须在 `agent_workspace` 下。
   - `agentHomeDirectory` 如传入，必须在 `agent_home` 下；未传则分配到 `agent_home/<agentId>`。
   - `skillSourceDirectories` 必须在 `skills` 下。
4. 创建单聊：
   - 显式 `workingDirectory` 必须在 `agent_workspace` 下。
   - 未传 `workingDirectory` 时分配到 `agent_workspace/chat-<sessionId>`。
   - `sessionHomeDirectory` 写入 `session/<sessionId>`。
5. 创建群聊：
   - 显式 `workspaceDir` 必须在 `agent_workspace` 下。
   - 未传时分配到 `agent_workspace/group-<groupId>`。
   - 群聊内部 `.agenthub/groups/...` 继续挂在群聊工作区内。

## Validation

- 用户 A 无法通过 `workspace-fs` 浏览用户 B 的目录。
- 所有路径校验拒绝根外路径、其他用户目录、空路径和符号链接逃逸。
- 未传单聊/群聊 workspace 时，目录自动落在当前用户 `agent_workspace` 下。
- 单聊 `sessionHomeDirectory` 自动落在当前用户 `session` 下。
- `skillSourceDirectories` 只能从当前用户 `skills` 下导入。

## Known Limits

- 本版本不实现 skill 上传接口，只限制已有 `skillSourceDirectories` 的来源目录。
- 不做历史存量路径迁移；当前快速开发阶段按新规则约束新建/更新链路。
- 不提供普通用户跨用户目录或全局目录选择能力。
