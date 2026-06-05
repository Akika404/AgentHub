# Codex 系统提示词支持

## 背景

AgentHub 存储 Agent 级别的 `systemPrompt`，并通过 `AgentAdapterConfig` 传递它。
Claude 已通过 `claude-agent-sdk` 的 `options.systemPrompt` 支持此功能。Codex SDK 未在线程选项上公开类型化的 `systemPrompt` / `system_prompt` 选项，但其 `CodexOptions.config` 接受 Codex CLI 配置覆盖。Codex 核心将 `instructions` 映射为有效的 `base_instructions`，因此 AgentHub 可以通过设置 `config.instructions` 来支持 Codex 系统提示词。

## 模型

- `AgentAdapterConfig.systemPrompt` 保持为统一的适配器级别字段。
- `AgentCapabilities.supportsSystemPrompt` 对 Claude 和 Codex 均为 true。
- Codex 支持 AgentHub 的 `skills`，通过会话工作目录下的 `.codex/skills` 被 SDK 发现；Claude 形态的 `mcpServers` 仍不支持。

## 后端 API

- Agent 创建/更新负载继续使用 `systemPrompt`。
- Codex Agent 现在可以提供 `systemPrompt`；它将存储在 Agent 上并在 `AgentView` 中返回。
- 不支持的验证继续拒绝 Codex 的 `mcpServers`；`skills` / `skillSourceDirectories` 可用于导入到 Codex vendor skills 目录。

## 运行时流程

1. `agentToConfig()` 将 `agent.systemPrompt` 复制到 `AgentAdapterConfig.systemPrompt` 中。
2. `CodexAdapter.ensureCodex()` 构建单一的 `CodexOptions.config` 对象。
3. 当存在非空的系统提示词时，适配器设置 `config.instructions`。
4. 现有的自定义提供商覆盖（`model_providers` 和 `model_provider`）保留在同一配置对象中。
5. `startThread()` / `resumeThread()` 行为不变。

## 验证

- 实现后运行服务端 TypeScript 检查。
- 确认共享/服务端能力声明一致认为 Codex 支持系统提示词。
- 确认过时的文档和 UI 能力门控不再将 Codex 系统提示词描述为不受支持。

## 已知限制

- Codex 系统提示词支持依赖于 Codex CLI 配置键 `instructions`，而非专用的 SDK 线程选项。
- Codex MCP 仍不受支持；skills 已由会话工作区 vendor 配置同步支持。
