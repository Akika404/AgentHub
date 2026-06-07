# 群聊成员任务「挂起 / 恢复」：等待用户答复（waiting_input）

> 本文承接 [`group-chat-orchestration-hardening.md`](./group-chat-orchestration-hardening.md)（DAG 并行 / 失败降级 / 冲突上报）与 [`group-chat-orchestrator-continuity.md`](./group-chat-orchestrator-continuity.md)（续聊 Case A/B/C）。
> 后端改动集中在 `apps/server/src/multiagents/group/run/` 与 `blackboard/`；契约改动在 `packages/shared/src/`；前端仅补状态标签（无交互式提问 UI）。

---

## Context（为什么做）

复盘日志：用户提"开发时区计算器"，Orchestrator 正确拆出 `t1 产品经理需求梳理` 与
`t2 前端实现（deps:[t1]）`。产品经理向用户反问后本应等回答，但前端却立刻开工。

根因：

1. 群聊后台派发是**游离运行**，`AskUserQuestion` 工具拿不到真实用户输入通道，会被权限拒绝
   （`permission_denials` / `"Answer questions?"`），成员只能以普通文本结束本轮。
2. 派发成功判定为 `success = !fatal && !escalation`（`dispatch.service.ts`）。成员"只提了个问题就结束"
   没有 fatal，被判 success → 任务置 `done`。
3. 调度器 `computeReady` 要求 `deps.every(d => status===done)`；`t1` 一旦 done，`t2` 立即放行。
4. 框架**缺少**"等待用户输入"的任务态，成员无法把任务图暂停、交还控制权给用户。

---

## Scope（范围）

### 覆盖

1. 新增任务态 `waiting_input`（成员挂起等待用户答复）与运行态 `waiting`。
2. **触发**：成员在收尾 `report` 里设 `awaiting_user_input:true`（+ `question`）。不依赖不可用的
   `AskUserQuestion`；派发 prompt 明确禁用它并说明挂起/恢复语义。
3. **调度语义**：挂起任务**不判 done、不判 failed**——既不满足下游 `deps===done`（不放行），
   也不触发 `markDownstreamBlocked`（不阻塞）。
4. **恢复**：用户下一条回复 →（单挂起自动恢复 / 多挂起靠 `@成员` 消歧）→ 强制 Case A 续接同一
   SDK 会话，把答复作为新一轮喂回成员，完成后继续调度释放下游。
5. 汇报里单列"⏸ 正在等待你的回复"。

### 不在本次（推迟）

- 挂起期间发"全新需求"的语义识别（见 Known Limits）。

### 追加：交互式提问卡片（agent-question）

成员挂起时若在 report 输出结构化 `questions`（镜像 AskUserQuestion：`question/header/options[{label,description}]
/multiSelect/allowText`），群里渲染一张**提问卡片**；用户逐题勾选/补充 → 点「提交」→ 前端拼成一句中文回复，
带 `mentions:[该成员]` 经 `converse` 自动发送 → 命中恢复。无结构化时回退为纯文本提问。

- 契约：`packages/shared/src/chat.ts` 新增 `AgentQuestion(Option)` + `AgentQuestionMessage`/`GroupAgentQuestionView`，
  并入 `ChatMessage`/`GroupMessageView` 联合。
- 后端：新消息 kind `agent-question`；`group-message.service.ts` 加 `appendAgentQuestion`（服务端归一化
  question/option id）与 `markAgentQuestionAnswered`；mapper/DTO 各补一处；`dispatch.service.ts` 挂起分支据
  `report.questions` 落卡片；`group-run.executor.ts` 恢复命中时标记卡片已作答。
- 前端：`components/messages/AgentQuestionMessage.vue`（单选/复选 + 描述 + 补充框 + 单个提交按钮 + 拼接），
  `MessageList`/`groupMessage.ts`/`ChatView` 接线；`sendGroupMessage` 支持 `mentions`。

---

## Model（契约改动）

- `packages/shared/src/blackboard.ts`：`BlackboardTaskStatus` 增加 `'waiting_input'`。
- `apps/server/.../entities/group-run.entity.ts`：`GroupRunStatus` 增加 `'waiting'`。
- `apps/server/.../dto/blackboard-response.dto.ts`：`TASK_STATUSES` 同步增加（OpenAPI 一致）。
- 列均 `varchar(16)`、无 DB enum 约束，无需迁移。`TaskItem['status']` 不新增取值，`waiting_input`
  在 `toTaskItemStatus` 映射为 `'in-progress'`。

成员收尾报告新增可选字段：

```jsonc
{ "summary": "等待用户确认需求", "awaiting_user_input": true, "question": "你的问题正文" }
```

## Flow（关键流程）

挂起（`dispatch.service.ts`）：解析 report 后**优先**判挂起——`!fatal && awaiting_user_input` 时，
把 `question` 作为群消息发出、写热缓冲，**跳过** writeback/合并/applyReport，返回
`DispatchResult.suspended = { question }`。

调度（`group-run.executor.ts#drive`）：成员挂起 → `setStatus(node,'waiting_input')` + outcome
`status:'waiting_input'`，**不**调 `markDownstreamBlocked`。`waiting_input` 不属 `ACTIVE`，故
`computeReady` 不再挑它、下游 `deps` 未满足自然不就绪。运行以 `waiting` 收尾（非 failed），
释放群活跃锁，挂起任务与下游 pending 留库。

隐藏交接判断：即使成员没有按 report 格式设置 `awaiting_user_input`，只要它成功返回后实际是在用
普通文本向用户澄清/提问，`group-run.executor.ts` 会先调用 Orchestrator 的隐藏 handoff review
确认是否可以释放下游。若判定仍在等待用户输入，则同样把当前 task 标为 `waiting_input`；该判断不写
展示消息、不推 `orchestrator_report`，因此用户只会看到成员自己的提问，然后直接回复即可继续。

恢复（`group-run.executor.ts#resolveResume` + `#drive(resume)`）：新一轮 `converse` 前先查本群
`waiting_input` 任务；命中则以原图 `runId` 重载全图节点，对挂起节点用强制 `Case A`
continuity（`adapter.resumeWith(sdkSessionId)`）把用户回复作为 `objective` 喂回，完成后进入常规
调度循环释放下游。会话句柄在挂起那一轮已持久化（无 TTL），故恢复不依赖 Redis 热缓冲窗口。

要点：

- **不重试挂起任务**：`dispatchWithRetry` 对 `suspended` 短路返回（否则会重复 `createTaskWorktree`
  撞 "branch already exists" 导致整轮失败）。
- **worktree 幂等复用**：挂起时跳过 merge/清理，保留任务 worktree（含成员草稿如 `REQUIREMENTS.md`）；
  `createTaskWorktree` 对同一 taskId 复用既有 worktree/分支，使恢复在同一工作区无缝续接。

## Known Limits（已知边界）

- **挂起期间发新需求**：单挂起任务时，无 `@` 的下一条会被当作答复（auto-resume 取舍）；逃生口是
  `@` 其它成员 / Orchestrator。
- **多挂起消歧**靠 `@mention`；无 `@` 时只提示不猜测。
- Orchestrator 汇报默认调用最终审查 LLM 做综合确认；模板拼接仅作为审查器失败时的兜底。
- 隐藏 handoff review 调用失败时，为避免 Orchestrator 异常把任务图永久卡死，会按成员原始
  `DispatchResult` 继续；结构化 `report.awaiting_user_input` 仍是最稳定的挂起路径。

## Test（验证）

- 纯逻辑：`run/group-run.executor.spec.ts` —— 上游成员普通文本提问时标记 `waiting_input`、下游不启动、Orchestrator 不追加汇报；多阶段续编排与最终审查缺口继续派发。
- 类型/构建：`pnpm typecheck`（-r）、`pnpm -F @agenthub/server build`。
- 端到端：产品经理反问 → 任务 `waiting_input`、前端不开工、run `waiting`；用户回复 → 同会话恢复
  （`turn_started.resumedSdkSessionId` + `continuityCase:'A'`）→ 产品经理产出 → done → 前端开工。
