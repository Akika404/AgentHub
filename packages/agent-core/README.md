# @agenthub/agent-core

**框架无关的 Agent 引擎**：把 Claude Agent SDK / OpenAI Codex SDK 归一为统一的 `AgentEvent` 流，并提供工作区 git diff/commit 与产物预览能力。被 desktop 主进程（本地 runner）与 server（`multiagents/adapter` 重导出）共同复用，本身不依赖任何 Web 框架。

## 目录结构

```
packages/agent-core/
├── package.json
├── tsconfig.json / tsconfig.build.json
└── src/
    ├── index.ts                       # barrel：重导出 adapters、WorkspaceGit、artifact preview
    ├── logger.ts                       # 极简 CoreLogger 接口 + no-op 默认实现
    ├── adapter/
    │   ├── types.ts                    # 统一 AgentEvent / AgentAdapter / 配置 / 能力类型
    │   ├── capabilities.ts             # 各 vendor 能力描述（单一事实源）
    │   ├── index.ts                    # adapter 导出 + createAgent(vendor) 工厂
    │   ├── claude.ts                   # Claude Agent SDK 适配器，归一其流为 AgentEvent
    │   └── codex.ts                    # OpenAI Codex SDK 适配器，归一其流为 AgentEvent
    └── workspace/
        ├── workspace-git.ts            # 框架无关 git 引擎：工作区 diff / commit
        └── artifact-preview.ts         # 安全构建产物文件预览（text/html/image/dataUrl）
```

## 命令

```bash
pnpm -F @agenthub/agent-core typecheck
pnpm -F @agenthub/agent-core build      # 产出 dist/
```
