# 单 Agent 聊天接入计划

## Summary

把桌面端聊天页从 mock 切到真实 Agent 单聊：左侧聊天列表显示当前用户已添加的全部 Agent，选择 Agent 后加载其后端消息历史，发送消息通过后端 SSE 流式返回。主聊天区只显示用户/Agent 文本消息；thinking、tool、todo 等运行事件显示在右侧状态区域，不进入聊天历史。

## Public APIs / Types

- 在 `@agenthub/shared` 补齐单聊契约：
  - `AgentEvent` 及相关事件类型，供前端消费 SSE。
  - `AgentChatMessageView`：`id / agentId / role('user'|'agent'|'system') / text / createdAt`。
- 后端新增接口：
  - `GET /api/agents/:agentId/messages`：返回该 Agent 的持久化聊天消息，按时间升序。
  - 保留 `GET /api/agents/:agentId/converse?prompt=...` SSE；增强为同时写入消息历史。
- 后端 `POST /api/agents/:agentId/clear` 同步清空该 Agent 的 UI 消息历史；`DELETE /api/agents/:agentId` 删除相关消息。

## Implementation Changes

- 后端新增 `agent_message` 实体与 DTO/mapper：
  - 发送前持久化用户消息。
  - 流式过程中累积 `text` 事件，前端实时显示。
  - turn 结束后持久化一条 Agent 文本消息；fatal error 且无文本时持久化一条 system 错误消息。
  - `thinking/tool_use/tool_result/todo` 只作为实时事件发给前端，不写入历史。
- Electron 主进程代理新增 SSE bridge：
  - `api:stream:start` 用 Node `fetch` 请求后端，带 `Authorization` header，解析 SSE `data:` 帧。
  - 通过 IPC 推送 `stream:event / stream:error / stream:done` 给 renderer。
  - `api:stream:cancel` 支持用户切换 Agent 或组件卸载时取消流。
  - 非 `text/event-stream` 响应按现有统一信封解析，处理 `UNAUTHORIZED` 和业务错误。
- 前端聊天页改为真实 Agent 数据流：
  - `ChatList` 数据来自 `agentApi.list()`，每个 `AgentView` 映射成 `ChatSummary(kind:'agent')`。
  - 选择 Agent 后调用 `GET messages`，把 `AgentChatMessageView` 映射为现有 `ChatMessage`。
  - 发送时先乐观追加用户消息，再通过 SSE bridge 接收事件；`text` 事件创建/追加当前 Agent 气泡，`error/done` 收尾。
  - 右侧 `RightInspector` 展示当前 Agent 配置摘要和实时运行状态：idle/thinking/tool/error/done、当前工具名、todo 概览。
  - 移除 `ChatView` 对 mock chat API 的依赖；保留 mock 文件给未接入模块使用。

## Test Plan

- 运行 `pnpm -F @agenthub/server typecheck`、`pnpm -F @agenthub/desktop typecheck`，再运行根 `pnpm typecheck`。
- 手动验证：
  - 已登录用户进入聊天页，左侧只显示自己已添加的 Agents。
  - 选择未聊过的 Agent 显示空历史和可发送输入框。
  - 发送消息后用户气泡立即出现，Agent 文本流式追加，结束后刷新/切换回来仍能看到历史。
  - thinking/tool/todo 只更新右侧状态区，不污染主聊天区。
  - 并发发送同一 Agent 时显示 `AGENT_BUSY` 错误，不重复写坏历史。
  - `clear` 后聊天历史为空；删除 Agent 后不再出现在列表。

## Assumptions

- 本次实现单 Agent 聊天，不做群聊编排。
- 消息历史只保存主聊天可见内容：user、agent、system error。
- 历史接口 v1 返回该 Agent 全部消息；分页留到消息量增长后再加。
- 状态区为实时运行态，刷新后不恢复历史 thinking/tool 状态。