# Agent 会话工作区 Vendor 配置同步 - Plan

## 目标

实现 `doc/spec/agent-session-workspace-vendor-config-sync.md`：

- Agent Home 存放 vendor 模板配置。
- 新建聊天时把 `.claude` / `.codex` 从 Agent Home 合并到聊天工作目录。
- 聊天工作目录可省略，由后端在 Agent Home 下自动创建递增 `TaskN`。
- 聊天工作目录不能等于 Agent Home。
- Codex 支持 skills，通过工作目录下 `.codex/skills` 发现。

## 涉及文件

- `apps/server/src/multiagents/adapter/capabilities.ts`
  - 将 Codex `supportsSkills` 改为 `true`。
- `apps/server/src/multiagents/adapter/types.ts`
  - 更新 skills 注释，说明 Codex 通过工作目录 `.codex/skills` 发现。
- `apps/server/src/multiagents/dto/create-agent-chat.dto.ts`
  - 将 `workingDirectory` 改为可选。
  - 更新 skills 注释，不再写死 Claude。
- `apps/server/src/multiagents/workspace/agent-workspace.service.ts`
- `apps/server/src/multiagents/agents/agent-config.service.ts`
- `apps/server/src/multiagents/chats/agent-chat.service.ts`
  - 增加 vendor 配置目录辅助函数。
  - 创建 / 更新 Agent 时按 vendor 初始化 Agent Home skills 目录。
  - skill 导入目标按 vendor 写入 `.claude/skills` 或 `.codex/skills`。
  - 创建聊天时解析可选工作目录，默认分配 `TaskN`。
  - 校验聊天工作目录不等于 Agent Home。
  - 创建聊天时把 Agent Home 的 vendor 配置目录合并到 Working Directory，目标优先。
  - 聊天级导入 skills 写入 Working Directory 的 vendor skills 目录。
- `packages/shared/src/agent.ts`
  - 将 Codex capability 改为支持 skills。
  - 将 `CreateAgentChatPayload.workingDirectory` 改为可选。
  - 更新注释。
- `apps/desktop/src/renderer/src/components/AgentCreateDialog.vue`
  - Codex 会自动开放 skills 字段，因为能力矩阵来自 shared。
  - 更新 placeholder / 文案为 vendor 通用。
- `apps/desktop/src/renderer/src/components/AgentChatCreateDialog.vue`
  - 工作目录允许留空。
  - 默认不再自动填入 Agent 默认工作目录。
  - 提示留空会使用 Agent Home 下的 TaskN。
  - 更新 skills 文案为 vendor 通用。
- 文档：
  - 检查 `README.md`、`apps/server/README.md`、相关 adapter README 是否需要同步说明。

## 实现步骤

1. 改后端能力声明和 DTO。
2. 重构 `AgentWorkspaceService` 目录工具：
   - `vendorConfigDirectoryName(vendor)`
   - `vendorConfigRoot(baseDirectory, vendor)`
   - `vendorSkillsRoot(baseDirectory, vendor)`
   - `ensureRuntimeDirectories(vendor, workingDirectory, agentHomeDirectory)`
   - `resolveChatWorkingDirectory(agent, dtoWorkingDirectory)`
   - `allocateDefaultTaskDirectory(agentHomeDirectory)`
   - `syncVendorConfigToWorkingDirectory(vendor, agentHomeDirectory, workingDirectory)`
3. 将原 `copyAgentSkillDirectories()` 替换为 vendor 配置同步。
4. 将 `importSkillSourceDirectories()` 改成显式接收目标 skills root，分别用于 Agent Home 和聊天 Working Directory。
5. 更新 shared 类型和桌面端表单。
6. 运行最小验证：
   - `pnpm -F @agenthub/shared typecheck`
   - `pnpm -F @agenthub/server typecheck`
   - 如前端类型受影响，再运行 `pnpm -F @agenthub/desktop typecheck`

## 风险与处理

- 旧数据可能存在 `agentHomeDirectory === workingDirectory`：保留 Agent 创建兼容行为，但创建聊天时禁止将聊天工作目录设为 Agent Home；若用户不填聊天工作目录，会自动使用 `TaskN`。
- 目标优先合并可能导致 Agent Home 更新不覆盖已有工作区配置：这是符合规格的预期行为。
- Codex MCP 未实现：保持 `supportsMcp: false`，避免错误暴露无法翻译的配置。
