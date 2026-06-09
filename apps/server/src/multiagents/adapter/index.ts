/**
 * 适配层 re-export barrel。
 *
 * 实现已抽到框架无关的 `@agenthub/agent-core`（types/claude/codex/capabilities/
 * createAgent 工厂），以便服务器与桌面端本地 runner 共用同一套执行核心。
 * 这里保留 barrel 仅为让现有 25+ 处 `'../adapter/index.js'` import 零改动继续可用。
 *
 * 新代码可直接 `import { ... } from '@agenthub/agent-core'`。
 */
export * from '@agenthub/agent-core'
