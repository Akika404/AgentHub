# Agent 多单聊会话 Spec

> 本文描述 AgentHub 当前“用户与单个 Agent 的多个独立聊天会话”的端到端设计。
> 后端模块位于 `apps/server/src/multiagents/`；桌面端入口为
> `apps/desktop/src/renderer/src/views/ChatView.vue`。

## 目标

单 Agent 聊天不再等同于 Agent 本身。用户点击聊天页左侧搜索框旁的 `+`，选择“创建聊天”，在弹窗中选择已有 Agent，并为这次聊天设置：

- 标题（可选；为空时客户端显示 Agent 名称 + 创建时间）。
- 工作目录（可选；不填时后端在 Agent Home 下创建递增 `TaskN`）。
- Skill 文件夹（可选；导入到本聊天工作目录的 vendor skills 目录）。
- MCP Servers JSON（可选，仅支持 Claude；与 Agent 原配置浅合并，同名 server 以聊天配置覆盖）。

新建聊天不支持设置 system prompt；运行时沿用 Agent 自身的 system prompt。一个 Agent 可以创建多个单 Agent 聊天，它们拥有独立的 SDK 句柄、工作目录、消息历史和运行时 busy 锁。

一轮对话（**turn**）作为服务端游离后台任务运行，与发起它的 HTTP 请求解耦：发起端切走聊天、关窗、断连都不会中止 turn，它会在后台跑到结束；任意端（含其它设备）可随时订阅同一 turn 的事件流，先回放本轮已发生的事件再实时追尾，实现「多端同时围观」。详见「后台运行与多端围观」。

## 数据模型

| 概念             | 含义                                                                                                               | 存储                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| Agent            | 用户创建的 Agent 配置，如展示名、头像/颜色标识、vendor、model、Provider、默认目录、system prompt                   | MySQL `agent`              |
| AgentSession     | Agent 运行会话；单聊使用 `scope=user`，包含 chat title、cwd、session home、SDK 句柄、有效 skills/MCP               | MySQL `agent_session`      |
| AgentMessage     | 某个聊天的 UI 主消息历史，只含 user / agent / system 文本                                                          | MySQL `agent_message`      |
| AgentMessageStep | 一条 agent 消息产出过程中的有序运行步骤（thinking / progress / tool / todo）                                       | MySQL `agent_message_step` |
| LiveAgent        | 进程内活实例，按 chat/session id 持有 adapter、busy、abort、lastUsedAt                                             | 内存 Map                   |
| Turn 事件流      | 一轮对话的事件广播+回放载体，一轮一条 Redis Stream；另含会话活跃指针、turn/session 归属索引与跨实例 abort 控制频道 | Redis Streams / pub/sub    |

`agent_session` 中 `scope=user` 的记录是左侧单聊列表的数据源；`scope=group` 为群聊成员内部运行会话，不进入 `/agent-chats`。`agent_message.sessionId` 是消息隔离边界。`agent_message_step` 以 `messageId` 关联某条 agent 消息、`seq` 排序，与该消息一对多；删除 Agent 会删除它的所有聊天和消息，删除/清空聊天会一并删除该聊天的运行步骤。

### AgentMessageStep 步骤模型

一轮 agent 回复 = 一条 `agent_message`（最终可见文本）+ 一组有序运行步骤。步骤类型与字段：

- `thinking`：推理文本存于 `text`。
- `progress`：面向用户的过程播报存于 `text`，例如工具调用前的说明文字。
- `tool`：把同一 `toolUseId` 的 `tool_use` 与 `tool_result` 合并为一行，存 `toolName`、`toolStatus`（started/completed/failed）、`isError`，以及**完整 `input` / `output`**（json）。
- `todo`：列表快照存于 `todos`（json）。

`tool` 行的 `input`/`output` 完整落库（如 WebSearch 结果、文件全文），不做截断。

## 后端接口

所有接口前缀为 `/api`，并且需要 `Authorization: Bearer <token>`。

| Method     | Path                                        | 说明                                                                |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------- |
| `GET`      | `/agents`                                   | 当前用户的全部 Agent 配置，用于管理页和创建聊天弹窗                 |
| `POST`     | `/agent-chats`                              | 创建单 Agent 聊天                                                   |
| `GET`      | `/agent-chats`                              | 当前用户的全部单 Agent 聊天，聊天页左侧列表使用                     |
| `GET`      | `/agent-chats/:chatId`                      | 查询单个聊天                                                        |
| `GET`      | `/agent-chats/:chatId/messages`             | 查询该聊天 UI 消息历史，按时间升序                                  |
| `POST`     | `/agent-chats/:chatId/converse`             | 启动一轮对话（后台游离运行），body 传 `prompt`，返回 `{ turnId }`   |
| `GET @Sse` | `/agent-chats/:chatId/turns/:turnId/events` | 订阅该轮事件流，先回放后追尾，逐条推送 `AgentEvent`，遇 `done` 结束 |
| `POST`     | `/agent-chats/:chatId/turns/:turnId/abort`  | 主动中止该轮（跨实例广播）                                          |
| `POST`     | `/agent-chats/:chatId/clear`                | 清空该聊天 SDK 句柄和 UI 消息历史                                   |
| `DELETE`   | `/agent-chats/:chatId`                      | 删除该聊天                                                          |

> 契约变更：旧版 `GET @Sse /agent-chats/:chatId/converse?prompt=` 一个端点既启动又流式返回、且客户端断连即中止；现拆分为「`POST converse` 启动（返回 turnId）」+「`GET turns/:turnId/events` 订阅」。启动是写操作、订阅是读操作，且订阅可被多端并发，是后台运行与多端围观的前提。

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
    capabilities: AgentCapabilities
  }
  title: string | null
  workingDirectory: string
  sessionHomeDirectory: string
  skills: 'all' | string[] | null
  mcpServers: Record<string, unknown> | null
  status: 'active' | 'suspended' | 'cleared'
  hasLiveSession: boolean
  /** 当前正在运行的 turn id；空闲为 null。前端据此在打开聊天时订阅进行中轮次的进度 */
  activeTurnId: string | null
  lastTurnAt: string | null
  createdAt: string
  updatedAt: string
}
```

消息视图包含 `chatId` 和 `agentId`，其中 `chatId` 用于前端缓存和 UI 隔离。`agent` 角色的消息可能带 `steps?: AgentRunStepView[]`，承载该轮回复的运行步骤（thinking/progress/tool/todo，tool 含完整 input/output），供前端复原“运行过程”折叠条。

## 后端流程

创建聊天时：

1. 校验 Agent 存在且属于当前用户。
2. 校验 vendor 能力：Codex 接受 skills，但仍不接受 mcpServers。
3. 规范化并创建 `workingDirectory`；未提供时分配 `<agentHomeDirectory>/TaskN`，且禁止与 Agent Home 相同。
4. 创建 `sessionHomeDirectory = <agentHomeDirectory>/.agenthub/chats/<chatId>`。
5. 将 Agent Home 下当前 vendor 的 `.claude` / `.codex` 配置合并到工作目录，目标已有文件/skill 优先；再导入本聊天指定 skill 文件夹。
6. 计算有效 skills：Agent 原 skills 与导入 skill 名称去重合并；Agent 原值为 `all` 时保持 `all`。
7. 计算有效 MCP：Agent 原 `mcpServers` 与聊天配置浅合并。
8. 保存 `scope=user` 的 `agent_session`，不开启底层 SDK 会话。

发送消息时（启动一轮 turn）：

1. 按 `chatId` 读取 `scope=user` 的 `AgentSession` 和 Agent 配置。
2. 生成 `turnId`，用 `SET NX EX` 把会话标记为「有一轮在跑」（兼作跨实例并发互斥锁），同时写入 `agent:turn:{turnId}:session` 归属索引。若已有活跃轮，返回 `AGENT_BUSY`，不启动新轮、不重复落库 user 消息；围观已有轮应通过 `activeTurnId` 订阅事件流。
3. 按 `session.id` 取或重建 `LiveAgent`；`workingDirectory/sessionHomeDirectory/skills/mcpServers` 来自聊天，模型、Provider、system prompt、tools/permission/reasoning 来自 Agent。若重建失败或后续启动前失败，会清理 active 指针与 turn/session 归属索引。
4. 保存用户消息到 `agent_message`，包含 `sessionId`。
5. **不 await** 地启动游离任务 `runTurn`，请求立即返回 `{ turnId }`。
6. `runTurn` 迭代 adapter 事件流：除最终 `done` 外，每条 `AgentEvent` `XADD` 到该 turn 的 Redis Stream 供多端订阅；同时在内存按 `seq` 累积为运行步骤草稿（`tool_use` 建行，`tool_result` 按 `toolUseId` 回填 output/isError）。adapter 的 `done` 只记录终态信息，不立即发布。
7. turn 结束（或被中止 / 异常 / 超时）后：回写 `sdkSessionId/lastTurnAt/status`、持久化 agent 或 system 回复消息；若存在 agent 回复，再把累积的运行步骤批量写入 `agent_message_step`；释放会话活跃指针；然后统一发布最终 `done`（让订阅端看到的终态代表后端可见状态已收口）；最后给事件流和 turn/session 归属索引设 TTL。

订阅一轮 turn（含围观）：

- `GET turns/:turnId/events` 先校验聊天属于当前用户，再校验 `turnId` 属于该聊天/session；通过后从该 turn 的 Redis Stream 以 `XRANGE` 回放已发生事件、再 `XREAD BLOCK` 追尾实时事件，遇 `done` 结束。每个订阅者独立连接与游标，互不影响——这是多端同时围观的核心。
- 断开本 SSE 连接只结束该订阅，**不会**中止 turn（无 `req.on('close') → abort` 耦合）。

中止一轮 turn：

- `POST turns/:turnId/abort` 同样先校验 `turnId` 属于该聊天/session；本地命中 `runningTurns` 直接 `abort()`，并 `PUBLISH` 控制频道覆盖其它实例。turn 被中止后仍会落库已产出的部分。

## 后台运行与多端围观

| 机制         | 实现                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 后台运行     | turn 是游离任务，生命周期与 HTTP 请求解耦；切走/关窗/断连只取消订阅，turn 继续跑到结束                                                                                          |
| 多端实时围观 | 一轮一条 Redis Stream，订阅端「回放 backlog + BLOCK 追尾」，多消费者各自游标，天然扇出                                                                                          |
| 发现进行中轮 | `AgentChatView.activeTurnId` 暴露当前活跃 turnId；桌面端加载/刷新聊天列表后会订阅所有活跃 turn，打开聊天时直接展示该订阅维护的实时进度                                          |
| 并发互斥     | 会话活跃指针 `SET NX`（跨实例锁）+ `LiveAgent.busy`（同实例兜底），一个聊天同时仅一轮                                                                                           |
| 归属校验     | `agent:turn:{turnId}:session` 记录 turn 所属 session；订阅和 abort 都必须匹配当前聊天                                                                                           |
| 主动停止     | `abort` 端点本地命中 + 控制频道跨实例广播                                                                                                                                       |
| 超时兜底     | `AGENT_TURN_TIMEOUT_MS` 限制单轮最长运行时间；超时会 abort、发布 fatal error，并以 `done(success=false)` 收口                                                                   |
| 启动回收     | 进程重启后游离任务已死；单实例下 boot 时清理残留活跃指针、补 turn/session 归属索引并给残留轮补 `done`（`AGENT_RECLAIM_ON_BOOT`，默认开，多实例应关）；另有活跃指针安全 TTL 兜底 |

> 选型：广播/回放用 **Redis Streams**，不引入 MQ。`XADD`/`XREAD BLOCK` 单原语即覆盖「回放历史 + 实时追尾 + 多消费者各自游标 + MAXLEN/TTL 裁剪」，正合围观语义；MQ 对单服务、单轮、低频事件属过度设计。封装见 `turn-stream.service.ts`。

## 桌面端流程

- `ChatList` 的 `+` 弹出菜单，包含“创建聊天”和禁用占位“创建群聊”。
- 创建聊天弹窗加载已有 Agent，选择 Agent 后默认填入 Agent 的默认工作目录。
- 聊天列表加载 `/agent-chats`，每条 `AgentChatView` 映射为 `ChatSummary`；若存在 `activeTurnId`，列表项显示运行标志，并为该 turn 建立后台订阅。
- 发送消息：先 `POST converse` 拿到 `turnId`，再订阅 `turns/:turnId/events`；切换聊天不会取消订阅，卸载页面只「detach」（取消订阅，不中止 turn）。
- 后台订阅按 chat 维护，事件复用与发送一致的 handler 渲染「进行中」的运行折叠条；当前打开聊天同步右侧 runtime，非当前聊天只更新对应 message cache 与列表运行态。若本地缓存里已有该聊天未完成的临时 `agent-run` 消息，会优先复用它，避免切走/切回后出现两张 Agent 运行卡；复用时会先把该临时卡重置为初始运行态，再用 Redis backlog 重建步骤，避免重复追加旧步骤。流结束后会重新加载 DB 历史，用后端权威消息覆盖本地临时态，并发出桌面通知；如果订阅结束但尚未收到 Agent `done`，前端会刷新 `activeTurnId` 并在该 turn 仍活跃时自动重新订阅。
- 输入区在有轮运行时显示「停止」按钮，点击调 `abort` 端点。
- `messageFromView` 在 `agent` 消息带 `steps` 时重建为 `AgentRunMessage`（运行过程折叠条）：thinking 标签按序复原为"思考中/继续思考"，tool 标签复原为"正在调用 {toolName}"，状态置 `done`；否则维持纯文本气泡。重开/刷新会话即可看到历史运行过程。
- 右侧状态区显示 Agent 摘要和当前聊天的真实 `workingDirectory/sessionHomeDirectory`。

## 已知限制

- 群聊只做菜单占位，尚未实现。
- 消息历史 v1 不分页。
- 运行步骤已持久化（thinking/progress/tool/todo，tool 含完整 input/output），前端复原折叠条目前还原 thinking/progress/tool；todo 历史不重建为面板。
- tool 的完整 `input`/`output` 已入库，但暂未提供"展开查看工具入参/返回"的 UI（与实时流一致），作为后续可选项。
- 空轮次（无最终文本也无致命错误）因无父消息行，其运行步骤不落库。
- clear 不删除底层 SDK 已落盘的旧会话文件。
- 多实例部署下：跨实例 abort 已支持（控制频道）；但 boot 回收默认只对单实例安全，多实例须设 `AGENT_RECLAIM_ON_BOOT=false`，残留活跃指针改由安全 TTL 兜底。turn 的执行实例路由（连续轮落到不同实例）仍依赖 `sdkSessionId` 续接，未做粘性会话。
- turn 事件流仅在 Redis 中保留 TTL（默认 1h）；晚于 TTL 才打开的端回退读 DB 历史（此时 turn 多半已结束）。
