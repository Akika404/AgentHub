# Codex 系统提示词支持 - 计划

## 目标

通过将 Agent 级别的 `systemPrompt` 传递给 `CodexOptions.config.instructions`，使 Codex Agent 能够使用它。

## 步骤

1. 更新能力声明：
  - `apps/server/src/multiagents/adapter/capabilities.ts`
  - `packages/shared/src/agent.ts`
2. 更新 Codex 运行时配置：
  - 导入 `CodexOptions`。
  - 为自定义提供商设置和 `instructions` 构建一个合并的配置对象。
  - 将合并后的配置传递给 `new Codex(...)`。
3. 更新过时的后端/共享注释和文档，这些内容称 Codex 系统提示词不受支持。
4. 保持 Codex 的 skills/MCP 不受支持。
5. 运行最小范围的相关类型检查。

## 文件

- `apps/server/src/multiagents/adapter/codex.ts`
- `apps/server/src/multiagents/adapter/capabilities.ts`
- `apps/server/src/multiagents/adapter/types.ts`
- `apps/server/src/multiagents/dto/agent-view.dto.ts`
- `packages/shared/src/agent.ts`
- `apps/server/src/multiagents/adapter/README.md`

## 验证

- `pnpm -F @agenthub/server typecheck`
