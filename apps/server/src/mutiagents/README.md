# mutiagents — 多 Agent 管理（AgentManager）

在 [`adapter/`](./adapter/) 统一适配层之上，提供虚拟员工的**生命周期管理**：创建、对话
（SSE 流）、暂存/恢复、清空历史。底层是 Claude / Codex 实例，对上通过 NestJS REST + SSE 暴露。

## 三层模型

| 概念 | 含义 | 存储 |
|------|------|------|
| **AgentSpec**（档案/配方） | vendor、model、workdir、systemPrompt、skills、mcp、tools 等不变配置 | MySQL（`agent_spec`） |
| **AgentSession**（会话句柄） | 客户端对话用的 id + 关联 spec + `sdkSessionId` + status | MySQL（`agent_session`） |
| **LiveAgent**（活实例） | 内存中的 `AgentAdapter` + busy + AbortController + lastUsedAt | 进程内存 `Map` |

会话内容由底层 SDK 落盘（Claude session 文件 / Codex thread rollout），Manager **只持久化句柄**
（`sdkSessionId`），因而能扛进程重启：缺失活实例时按 spec 重建 adapter 并 `resumeWith(sdkSessionId)` 续接。

## REST / SSE 接口（前缀 `/api`）

| Method | Path | 说明 |
|---|---|---|
| POST | `/agents` | 创建（持久化 spec + 开会话句柄），返回 `{ sessionId, specId, vendor, capabilities }` |
| GET | `/agents` | 列出所有会话视图 |
| GET | `/agents/:sessionId` | 会话视图 |
| GET `@Sse` | `/agents/:sessionId/converse?prompt=...` | 与 agent 对话，SSE 推送 `AgentEvent`（每条包成 `{ data: ev }`） |
| POST | `/agents/:sessionId/suspend` | 暂存（从内存驱逐，磁盘会话仍在） |
| POST | `/agents/:sessionId/restore` | 恢复并预热活实例（按 sdkSessionId resume） |
| POST | `/agents/:sessionId/clear` | 清空历史（丢弃句柄，下次对话开新会话） |
| DELETE | `/agents/:sessionId` | 删除会话（保留 spec） |

错误统一走 `BusinessException` + 全局过滤器：`NOT_FOUND(4000)` / `AGENT_BUSY(5002, 409)` /
`AGENT_UNAVAILABLE(5001)` / `VALIDATION_FAILED(3000)`。SSE 路由用 `@SkipEnvelope()` 跳过统一封装。

## 并发与生命周期

- **单会话串行**：进行中的 turn 再次对话 → `AGENT_BUSY`（Manager 同步 check-and-set，非裸 throw）。
- **驱逐**：LRU + 上限（`AGENT_MAX_LIVE` 默认 30；Codex 子进程较重，`AGENT_MAX_LIVE_CODEX` 默认 8），
  仅驱逐空闲(非 busy)实例；另有 idle-TTL 清扫（`AGENT_IDLE_TTL_MS` 默认 15min）。
- **句柄回写**：仅在每轮结束（`done`）持久化 `sdkSessionId`，绝不在流中途写，避免崩溃留半截。

## 已知限制 / TODO

- **权限审批**：本期 **auto-approve**（Claude `bypassPermissions` / Codex `approvalPolicy:"never"`）。
  已留 seam（`config.permissionMode` + 未来 `canUseTool`），交互审批为 phase-2。
  注意：turn 中途的审批需活实例常驻内存，**无法与"进程重启恢复"对同一 in-flight turn 同时成立**。
- **clear() 仅逻辑清空**：SDK 落盘的旧会话文件不会被删除（disk 增长、旧会话技术上仍可 resume）→ phase-2 清理任务。
- **进程重启**只能恢复**已完成轮次**的会话；崩溃时进行中的 turn 丢失，客户端需重发。
- **Codex 子进程**无 dispose API，驱逐只能丢引用靠 GC，故设活跃实例上限兜底。
- **厂商不对称**：Codex 不支持 systemPrompt/skills/MCP（见 `capabilities()`），创建时显式拒绝。
- **apiKey 不入库**：从 `ConfigService`（`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`）在重建时注入。
- **ESM 互操作**：两个 SDK 为 ESM-only，adapter 通过 `adapter/esm.ts` 运行时动态 import（详见 adapter README §8.4）。
