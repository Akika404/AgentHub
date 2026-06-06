# 群聊调试日志（Group Chat Debug Logging）

> 模块位于 `apps/server/src/multiagents/group/`，聚焦群聊运行时的服务端 debug 可观测性。

## Context

群聊一次运行会穿过用户输入、MessageRouter、ContinuityResolver、Orchestrator、Blackboard、ContextAssembler、Dispatch、成员 Agent turn、memory 写入等多个环节。当前只有错误日志，定位“为什么派给这个 Agent”“Agent 实际收到什么上下文”“黑板和记忆读到了什么”时需要临时打点。

本功能新增统一的群聊调试日志，输出足够还原一次运行的关键状态，供开发阶段排查 Orchestrator 决策、任务分配、上下文装配、黑板/记忆读取与成员执行问题。

## Model

不新增数据库实体、不修改共享 API 契约。

新增服务端内部模型：

- `GroupDebugLogger`：群聊专用结构化 debug logger，统一日志前缀、脱敏与长文本截断。
- `ContextAssemblerOutput.debug`：仅服务端内部使用的调试快照，包含黑板快照、原始/保留/丢弃 memory、prompt 长度等。

日志字段使用 JSON 结构，至少带 `tag`、`groupId`、`runId`（如有）、`agentId`（如有）与阶段数据。敏感 key（如 `apiKey` / `token` / `secret` / `password`）必须脱敏，长字符串默认截断。

## Backend API

无新增 HTTP API。

## Runtime Flow

1. 用户调用 `POST /group-chats/:id/converse` 后，记录：
   - 用户输入 text、mentions、groupId、runId
   - 群成员摘要
   - MessageRouter 路由结果
2. `ContinuityResolver` 记录：
   - short-term buffer 是否命中
   - 强指代判断
   - 黑板 artifact 匹配结果
   - 最终 A/B/C 与是否需要 Orchestrator 判断
3. `OrchestratorService` / `LlmOrchestratorPlanner` 记录：
   - 当前黑板快照与 blackboardSummary
   - 成员状态、用户输入、显式提及
   - 发送给 Orchestrator 的 prompt
   - Orchestrator 原始输出/结构化输出
   - 最终任务图与 agent 分配
4. `ContextAssembler` 记录：
   - 读取到的黑板信息
   - 每个 Agent 检索到的 memory、保留 memory、丢弃 memory
   - targetArtifacts、contracts、omitted、prompt 长度
5. `DispatchService` 记录：
   - 每个 Agent 收到的任务、continuity、worktree、session
   - 每个 Agent 收到的最终 prompt / 指令
   - turn 事件摘要、最终输出、解析出的 report
   - git diff、黑板更新、memory candidate、hot buffer 写入
6. `BlackboardService` / `AgentMemoryService` 记录：
   - 黑板读快照、写入 artifact/decision/contract/task/event
   - memory 检索、去重跳过、写入、mark stale

## Validation

- `pnpm -F @agenthub/server typecheck`
- 运行群聊请求时，服务端 debug 日志中能按 runId 串联用户输入、路由、Orchestrator 计划、黑板快照、Agent prompt、memory 与黑板更新。

## Known Limits

- 日志仅输出到 Nest Logger，不新增持久化调试表或前端调试面板。
- 长 prompt / 输出会被截断；需要完整内容时可临时调大 `GROUP_DEBUG_LOG_MAX_CHARS`。
- 日志包含用户输入和 Agent 上下文，默认用于开发调试；生产环境可通过 `GROUP_DEBUG_LOGS=false` 关闭。
