# 群聊调试日志 — 实现 Plan

> 对应 Spec：[`doc/spec/group-chat-debug-logging.md`](../spec/group-chat-debug-logging.md)

## 1. 调试日志服务

- 新增 `apps/server/src/multiagents/group/debug/group-debug-logger.service.ts`
- 提供 `log(tag, payload)`、`snapshotBlackboard(view)`、`compactText(text)` 等能力
- 从 `GROUP_DEBUG_LOGS` 读取开关，默认开启；从 `GROUP_DEBUG_LOG_MAX_CHARS` 读取长文本截断上限
- 对 `apiKey` / `token` / `secret` / `password` 等字段递归脱敏

## 2. 注入群聊模块

- 在 `GroupChatModule` provider 注册 `GroupDebugLogger`
- 注入到 `GroupRunExecutor`、`OrchestratorService`、`LlmOrchestratorPlanner`、`DispatchService`、`ContextAssembler`、`BlackboardService`、`AgentMemoryService`、`ContinuityResolver`

## 3. 运行链路打点

- `GroupRunExecutor.startRun/runGroup/runDirectSingle/runOrchestrated`
  - 记录用户输入、成员列表、路由结果、运行开始/结束、直派或编排分支
- `ContinuityResolver.resolve`
  - 记录 hot buffer、指代判断、artifact 匹配、A/B/C 结果
- `OrchestratorService.plan/report`
  - 记录黑板快照、编排上下文、计划任务与最终汇报
- `LlmOrchestratorPlanner`
  - 记录 Orchestrator prompt、原始输出、结构化输出与解析结果
- `ContextAssembler.assemble`
  - 记录黑板、memory、trace 与 prompt 长度，并在 output.debug 中返回快照
- `DispatchService.dispatch/runMemberTurn/applyReport/writeHotBuffer`
  - 记录 Agent 收到的指令、上下文、worktree/session、turn 事件、report、diff、黑板更新、memory 写入
- `BlackboardService` / `AgentMemoryService`
  - 记录黑板和记忆的关键读写

## 4. 文档与验证

- 更新 `apps/server/README.md` 的环境变量说明
- 如根 README 行为描述不变，则无需修改
- 执行 `pnpm -F @agenthub/server typecheck`
