# 消息重新生成实现计划

## 目标

在消息右键菜单中新增“重新生成”，支持单 Agent 聊天基于已有用户消息或 Agent 回复重新启动一轮后台 turn，并复用现有流式展示。

## 步骤

1. 更新共享契约
   - 在 `packages/shared/src/agent.ts` 中补充 `StartTurnResult` 注释，使其覆盖 converse 与 regenerate 两类启动接口。

2. 后端解析与接口
   - 在 `AgentMessageHistoryService` 增加 `resolveRegeneratePrompt(userId, sessionId, messageId)`。
   - 在 `AgentRuntimeService` 抽出可选择是否保存用户消息的 turn 启动逻辑。
   - 在 `AgentChatService` 增加 `regenerateFromMessage`，校验归档状态并调用 runtime。
   - 在 `AgentManager` 暴露对应方法。
   - 在 `AgentChatsController` 增加 `POST :chatId/messages/:messageId/regenerate`。

3. 桌面端 API 与 UI
   - 在 `apps/desktop/src/renderer/src/api/agents.ts` 增加 `agentChatApi.regenerate`，返回并订阅 `AgentConverseStream`。
   - 在 `MessageList.vue` 增加可配置的 `regenerate` 菜单项与事件。
   - 在 `ChatView.vue` 仅对单聊启用重新生成，并复用现有 Agent turn 流式处理。

4. 文档同步
   - 更新 `doc/message-card-spec.md` 公共右键菜单说明。
   - 检查 README 是否需要更新；本功能不改变启动/构建方式时不修改 README。

5. 验证
   - 添加/更新服务端单元测试覆盖消息源解析。
   - 运行 `pnpm -F @agenthub/server test` 与桌面端 typecheck。
