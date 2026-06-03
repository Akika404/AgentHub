Agent 多单聊会话 Spec

> 本文描述 AgentHub 当前“用户与单个 Agent 的多个独立聊天会话”的端到端设计。
> 后端模块位于 `apps/server/src/mutiagents/`；桌面端入口为
> `apps/desktop/src/renderer/src/views/ChatView.vue`。

## 目标

单 Agent 聊天不再等同于 Agent 本身。用户点击聊天页左侧搜索框旁的 `+`，选择“创建聊天”，在弹窗中选择已有 Agent，并为这次聊天设置：

- 标题（可选；为空时客户端显示 Agent 名称 + 创建时间）。
- 工作目录（必填，会话级覆盖）。
- Skill 文件夹（可选，仅支持 Claude；导入到本聊天私有 home）。
- MCP Servers JSON（可选，仅支持 Claude；与 Agent 原配置浅合并，同名 server 以聊天配置覆盖）。

新建聊天不支持设置 system prompt；运行时沿用 Agent 自身的 system prompt。一个 Agent 可以创建多个单 Agent 聊天，它们拥有独立的 SDK 句柄、工作目录、消息历史和运行时 busy 锁。

## 数据模型

| 概念             | 含义                                                                                             | 存储                       |
| ---------------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| Agent            | 用户创建的 Agent 配置，如展示名、头像/颜色标识、vendor、model、Provider、默认目录、system prompt | MySQL `agent`              |
| AgentSession     | 一个单 Agent 聊天会话，包含 chat title、cwd、session home、SDK 句柄、有效 skills/MCP             | MySQL `agent_session`      |
| AgentMessage     | 某个聊天的 UI 主消息历史，只含 user / agent / system 文本                                        | MySQL `agent_message`      |
| AgentMessageStep | 一条 agent 消息产出过程中的有序运行步骤（thinking / tool / todo）                                | MySQL `agent_message_step` |
| LiveAgent        | 进程内活实例，按 chat/session id 持有 adapter、busy、abort、lastUsedAt                           | 内存 Map                   |

`agent_session` 是左侧聊天列表的数据源；`agent_message.sessionId` 是消息隔离边界。`agent_message_step` 以 `messageId` 关联某条 agent 消息、`seq` 排序，与该消息一对多；删除 Agent 会删除它的所有聊天和消息，删除/清空聊天会一并删除该聊天的运行步骤。

### AgentMessageStep 步骤模型

一轮 agent 回复 = 一条 `agent_message`（最终可见文本）+ 一组有序运行步骤。步骤类型与字段：

- `thinking`：推理文本存于 `text`。
- `tool`：把同一 `toolUseId` 的 `tool_use` 与 `tool_result` 合并为一行，存 `toolName`、`toolStatus`（started/completed/failed）、`isError`，以及**完整 `input` / `output`**（json）。
- `todo`：列表快照存于 `todos`（json）。

`tool` 行的 `input`/`output` 完整落库（如 WebSearch 结果、文件全文），不做截断。

## 后端接口

所有接口前缀为 `/api`，并且需要 `Authorization: Bearer <token>`。

| Method     | Path                                       | 说明                                                |
| ---------- | ------------------------------------------ | --------------------------------------------------- |
| `GET`      | `/agents`                                  | 当前用户的全部 Agent 配置，用于管理页和创建聊天弹窗 |
| `POST`     | `/agent-chats`                             | 创建单 Agent 聊天                                   |
| `GET`      | `/agent-chats`                             | 当前用户的全部单 Agent 聊天，聊天页左侧列表使用     |
| `GET`      | `/agent-chats/:chatId`                     | 查询单个聊天                                        |
| `GET`      | `/agent-chats/:chatId/messages`            | 查询该聊天 UI 消息历史，按时间升序                  |
| `GET @Sse` | `/agent-chats/:chatId/converse?prompt=...` | 与该聊天对话，返回 `AgentEvent` SSE 流              |
| `POST`     | `/agent-chats/:chatId/clear`               | 清空该聊天 SDK 句柄和 UI 消息历史                   |
| `DELETE`   | `/agent-chats/:chatId`                     | 删除该聊天                                          |

创建聊天入参：

```ts
interface CreateAgentChatPayload {
  agentId: string
  title?: string
  workingDirectory: string
  skillSourceDirectories?: string[]
  mcpServers?: Record<string, unknown>
}
```

聊天视图核心字段：

```ts
interface AgentChatView {
  id: string
  agentId: string
  agent: {
    id: string
    name: string
    avatar: string | null
    color: string
    vendor: AgentVendor
    model: string
  }
  title: string | null
  workingDirectory: string
  sessionHomeDirectory: string
  skills: 'all' | string[] | null
  mcpServers: Record<string, unknown> | null
  status: 'active' | 'suspended' | 'cleared'
  hasLiveSession: boolean
  lastTurnAt: string | null
}
```

消息视图包含 `chatId` 和 `agentId`，其中 `chatId` 用于前端缓存和 UI 隔离。`agent` 角色的消息可能带 `steps?: AgentRunStepView[]`，承载该轮回复的运行步骤（thinking/tool/todo，tool 含完整 input/output），供前端复原“运行过程”折叠条。

## 后端流程

创建聊天时：

1. 校验 Agent 存在且属于当前用户。
2. 校验 vendor 能力：Codex 不接受 skillSourceDirectories / mcpServers。
3. 规范化并创建 `workingDirectory`。
4. 创建 `sessionHomeDirectory = <agentHomeDirectory>/.agenthub/chats/<chatId>`。
5. Claude 聊天复制 Agent 原 `.claude/skills` 到会话私有 home，再导入本聊天指定 skill 文件夹。
6. 计算有效 skills：Agent 原 skills 与导入 skill 名称去重合并；Agent 原值为 `all` 时保持 `all`。
7. 计算有效 MCP：Agent 原 `mcpServers` 与聊天配置浅合并。
8. 保存 `agent_session`，不开启底层 SDK 会话。

发送消息时：

1. 按 `chatId` 读取 `AgentSession` 和 Agent 配置。
2. 按 `session.id` 取或重建 `LiveAgent`；`workingDirectory/sessionHomeDirectory/skills/mcpServers` 来自聊天，模型、Provider、system prompt、tools/permission/reasoning 来自 Agent。
3. 以 `session.id` 检查 busy，忙则返回 `AGENT_BUSY`。
4. 保存用户消息到 `agent_message`，包含 `sessionId`。
5. 流式转发 `AgentEvent`；`text` 事件进入主聊天气泡，thinking/tool/todo 实时更新右侧状态区，同时在内存按 `seq` 累积为运行步骤草稿（`tool_use` 建行，`tool_result` 按 `toolUseId` 回填 output/isError）。
6. turn 结束后回写 `sdkSessionId/lastTurnAt/status`，持久化 agent 或 system 回复消息；若存在 agent 回复，再把累积的运行步骤批量写入 `agent_message_step`（挂到该消息 id）。

## 桌面端流程

- `ChatList` 的 `+` 弹出菜单，包含“创建聊天”和禁用占位“创建群聊”。
- 创建聊天弹窗加载已有 Agent，选择 Agent 后默认填入 Agent 的默认工作目录。
- 聊天列表加载 `/agent-chats`，每条 `AgentChatView` 映射为 `ChatSummary`。
- 选择聊天、消息缓存、发送消息、取消流、刷新历史全部以 `chatId` 为 key。
- `messageFromView` 在 `agent` 消息带 `steps` 时重建为 `AgentRunMessage`（运行过程折叠条）：thinking 标签按序复原为“思考中/继续思考”，tool 标签复原为“正在调用 {toolName}”，状态置 `done`；否则维持纯文本气泡。重开/刷新会话即可看到历史运行过程。
- 右侧状态区显示 Agent 摘要和当前聊天的真实 `workingDirectory/sessionHomeDirectory`。

## 已知限制

- 群聊只做菜单占位，尚未实现。
- 消息历史 v1 不分页。
- 运行步骤已持久化（thinking/tool/todo，tool 含完整 input/output），但前端复原折叠条目前只还原 thinking/tool；todo 历史不重建为面板。
- tool 的完整 `input`/`output` 已入库，但暂未提供“展开查看工具入参/返回”的 UI（与实时流一致），作为后续可选项。
- 空轮次（无最终文本也无致命错误）因无父消息行，其运行步骤不落库。
- clear 不删除底层 SDK 已落盘的旧会话文件。
