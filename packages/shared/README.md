# @agenthub/shared

跨 desktop ↔ server 边界的**共享 TypeScript 类型与协议契约**。改 API 形状时在 `src/` 改一处，两端同步生效。

> 运行期消费者加载编译产物 `dist/`，TypeScript 类型仍从 `src/` 解析。改完类型后需 `pnpm -F @agenthub/shared build` 产出 `dist/`。

## 目录结构

```
packages/shared/
├── package.json
├── tsconfig.json / tsconfig.build.json
└── src/
    ├── index.ts          # barrel：重导出全部契约模块
    ├── envelope.ts       # 统一 ApiResponse 信封 + 成功/错误码常量
    ├── user.ts           # 用户契约：视图、login/register/update 入参
    ├── provider.ts       # Provider 契约：ProviderType、视图、create/update 入参
    ├── agent.ts          # 单 Agent 契约：AgentView、聊天、事件、能力、payload
    ├── chat.ts           # 渲染层聊天/消息视图类型 + AgentHubApi 接口
    ├── group-chat.ts     # 群聊契约：成员、Orchestrator、运行事件 SSE 流
    ├── blackboard.ts     # 群黑板契约：产物、决策、契约、task graph、memory
    ├── deployment.ts     # 部署清单 + 线上服务部署生命周期与日志事件
    ├── workspace-diff.ts # 工作区 git diff 摘要 + 提交结果类型
    ├── workspace-fs.ts   # 服务端目录浏览 + 本地 skill 文件夹导入类型
    └── local-runner.ts   # 桌面端本地 runner 执行的反向 WebSocket 协议
```

## 命令

```bash
pnpm -F @agenthub/shared typecheck
pnpm -F @agenthub/shared build      # 产出 dist/（运行期消费）
```
