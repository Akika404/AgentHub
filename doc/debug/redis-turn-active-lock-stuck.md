# Redis turn active lock 导致 Agent 运行态卡住/错位

## 背景

`feat(server,desktop,shared): detached turns with redis-streams multi-device watch`
把一次 Agent 对话从原来的「HTTP/SSE 请求生命周期内运行」改成了「服务端后台 turn 运行，Redis Stream 广播事件，客户端只订阅观看」。

这让切换页面、多端围观、断线重连成为可能，但也引入了几个必须同时成立的新不变量：

- 同一个 chat/session 同时只能有一个 active turn。
- 发送新 prompt 和围观已有 turn 必须是两个不同入口。
- 一个 `turnId` 必须只能被它所属的 chat/session 订阅或中止。
- 后端发布最终 `done` 时，DB 历史和 Redis active 指针必须已经进入终态。
- 前端重新围观同一个 active turn 时，必须复用旧的临时运行卡，而不是再创建一张。

本问题不是“Redis 不能存 turn 运行时状态”，而是 Redis 化后这些边界没有完全收紧。

## 现象

用户观察到过两类表现：

1. 发送「帮我调研一下 minimax m3 的用户评价」后，窗口一直停在「思考中」。
2. 新建另一个 Agent 会话，发送「当前文件夹下有哪些文件？」后，执行了几步，停在「继续思考」。
3. 第二个会话处于「继续思考」时，又出现了一条 Agent 消息：上一条 Agent 消息仍然显示正在思考，下面新出现的 Agent 消息才像是用户问题的回答。

这里的 UI 文案含义是：

- 「思考中」是前端创建运行卡时的初始占位。
- 「继续思考」是收到成功的 `tool_result` 后，前端主动追加的下一步占位。
- 如果后续没有 `text`、`turn_completed` 或 `done`，这张运行卡就会一直保持 active。

关键代码在 `ChatView.vue`：

```ts
case 'tool_result':
  completeActiveRunStep(chat.id, Boolean(event.isError), {
    toolUseId: event.toolUseId,
    output: event.output,
    isError: Boolean(event.isError)
  })
  if (!event.isError) startRunStep(chat.id, 'thinking', '继续思考', 'thinking')
  return
```

## 可复现条件

下面几个条件任意命中一个，都可能造成相似观感。

### 1. 同一 chat 已有 active turn，又发送了新 prompt

问题版本中，`startTurn()` 发现 Redis active turn 已存在时，没有返回 busy，而是把既存
`turnId` 返回给这次新 prompt：

```ts
const owned = await this.turnStream.acquireActiveTurn(session.id, turnId)
if (owned !== turnId) {
    return { turnId: owned }
}
```

前端此时已经乐观插入了用户的新消息，然后去订阅旧 turn 的 Redis Stream。结果是：

- 新 prompt 没有真正启动。
- 新插入的用户消息看起来像是在等待回答。
- 旧 turn 的事件被画到新 prompt 后面的临时 Agent 运行卡上。
- 如果旧 turn 卡住，UI 就一直「思考中/继续思考」。
- 如果旧 turn 后来产出文本，文本会被误认为是新 prompt 的回答。

`db59188` 已修复这一点：新 prompt 遇到 active turn 时返回 `AGENT_BUSY`；围观已有 turn
必须通过 `AgentChatView.activeTurnId` 调 `GET /turns/:turnId/events`。

### 2. 切走/切回同一个 active chat，前端重复创建运行卡

detached turn 改造后，切换 chat 或卸载页面只会断开本端订阅，不会中止服务端 turn：

```ts
await detachStream()
```

旧前端断开时会保留本地临时 `agent-run` 消息；切回该 chat 时，`selectChat()` 又把全局
`currentRunMessageId` 清空。随后 `watchTurn()` 收到 Redis backlog/live 事件，认为当前没有
运行卡，于是创建第二张运行卡。

这就能复现用户看到的现象：

- 第一张临时 Agent 卡停在「继续思考」。
- 第二张 Agent 卡继续接收同一个 turn 的后续事件。
- 如果后续事件里有最终文本，第二张卡显示回答，看起来像 Agent 又主动发了一条消息。

### 3. 服务端先发布 `done`，再落库和释放 active 指针

问题版本的 `runTurn()` 会把 adapter 产出的每个事件直接写入 Redis Stream，包括 `done`。
但 DB 落库、`releaseActiveTurn()`、`finalize()` 都在 `finally` 后半段。

因此前端可能已经收到 `done` 并触发刷新，但此时：

- 最终 agent message 还没保存进 DB。
- `AgentChatView.activeTurnId` 还没被清掉。

这会制造短暂但真实的竞态：前端刷新到旧 active 状态，随后又自动 watch，进一步放大重复运行卡和状态错位。

### 4. `turnId` 没有和 chat/session 做归属校验

问题版本的订阅接口只校验 `chatId` 属于当前用户：

```ts
await this.loadChat(userId, chatId)
return this.turnStream.subscribe(chatId, turnId)
```

它没有校验这个 `turnId` 是否真的属于这个 chat/session。正常 UI 大多会从
`activeTurnId` 取值，不容易手动传错；但只要前端状态缓存、重连、或其它客户端传入了错误
`turnId`，服务端就可能把别的 turn 的事件流接到当前 chat 上。

这也是为什么不能只靠“Redis key 名里有 turnId”判断安全。后台运行状态必须有归属索引。

### 5. detached turn 缺少最大运行时间

后台 turn 不再依赖 HTTP 连接断开来 abort。若底层 adapter 的 async iterator 长时间不结束，
`runTurn()` 就不会进入 `finally`，从而不会：

- 发布最终 `done`。
- 持久化最终消息。
- 释放 Redis active turn 指针。
- 给 Redis Stream 设置 TTL。

`db59188` 已新增 `AGENT_TURN_TIMEOUT_MS` 作为兜底，默认 30 分钟。超时后会 abort adapter、
发布 fatal `error`，并最终让订阅端收到 `done(success=false)`。

## 根因总结

这次问题是多个边界叠加，不是单一 Redis bug：

- `startTurn()` 把“发送新 prompt”错误地幂等映射成“订阅旧 turn”。
- Redis `acquireActiveTurn()` 在 `SET NX` 失败后存在 key 刚好过期的竞态，可能让调用方误以为自己持锁。
- 订阅和 abort 缺少 `turnId -> sessionId` 归属校验。
- `done` 发布早于 DB 落库和 active 指针释放。
- 前端只有一个全局 `currentRunMessageId`，切换 chat 后丢失了本地临时运行卡的关联。
- detached turn 缺少自身超时，底层 adapter 不结束时没有可靠收尾。

## 修复内容

### 已由 `db59188` 修复

1. 新 prompt 遇到 active turn 时返回 `AGENT_BUSY`。
2. `acquireActiveTurn()` 改为循环重试，避免 `SET NX` 失败后 `GET` 不到既存值却返回当前
   `turnId`。
3. 新增 `AGENT_TURN_TIMEOUT_MS`，后台 turn 超时后 abort 并收尾。

### 本次补充修复

1. Redis 增加 `agent:turn:{turnId}:session` 归属索引。
2. `GET /agent-chats/:chatId/turns/:turnId/events` 订阅前校验 turn 属于当前 chat/session。
3. `POST /agent-chats/:chatId/turns/:turnId/abort` 中止前也校验 turn 归属。
4. 启动 turn 失败时同时清理 active 指针和归属索引，避免留下无事件的孤儿 turn。
5. `runTurn()` 不再把 adapter 的 `done` 立即写入 Redis Stream，而是先记录终态。
6. DB 历史保存、active 指针释放完成后，再统一发布最终 `done`，然后给 stream 和归属索引设置 TTL。
7. 前端 `watchTurn()` 会优先复用当前 chat 缓存里的未完成 `agent-run` 消息。
8. 前端流结束后统一 `reloadAfterTurn()`，用 DB 权威历史覆盖本地临时运行态。

相关文件：

- `apps/server/src/mutiagents/turn-stream.service.ts`
- `apps/server/src/mutiagents/agent-manager.service.ts`
- `apps/desktop/src/renderer/src/views/ChatView.vue`
- `packages/shared/src/agent.ts`
- `apps/server/.env.example`

## 验证建议

最小验证：

```bash
pnpm typecheck
```

手工复现建议：

1. 启动一个会产生工具调用的 Agent turn。
2. 在工具调用后、最终回答前切换到其它 chat，再切回。
3. 预期：只保留一张运行卡，不应出现上一张卡停在「继续思考」而下面又出现第二张回答卡。
4. 同一个 chat active 时，从另一个窗口/客户端再次发送 prompt。
5. 预期：服务端返回 `AGENT_BUSY`，不会把新 prompt 绑定到旧 turn。
6. 用错误 `chatId + turnId` 组合请求订阅或 abort。
7. 预期：返回 not found，不会收到其它 chat 的事件流，也不会中止其它 chat 的 turn。
8. 让 adapter 超过 `AGENT_TURN_TIMEOUT_MS` 不结束。
9. 预期：前端收到 error + done，active turn 被释放，之后可以启动下一轮。

## 以后如何避免

- 后台任务必须有超时、abort 和终态事件，不能依赖 HTTP 连接生命周期。
- “发送新 prompt”和“观看已有 turn”要保持不同接口语义。
- Redis 运行时状态必须包含归属索引，不能只靠客户端传入的 `turnId`。
- 最终 `done` 应代表后端已经完成可见状态收尾，而不只是 adapter iterator 结束。
- 前端临时运行态要能被同一 turn 的重放事件复用，并在结束后被 DB 权威历史替换。
- 新增 detached/background 能力时，应补并发、重连、切换 chat、timeout、abort、错误 turnId 组合的回归测试。
