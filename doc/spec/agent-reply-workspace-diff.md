# 会话工作区变更面板

> 在单 Agent 聊天与群聊的输入框上方展示当前会话工作区相对上次“提交”按钮基线的累计文件变更，并提供一键提交/确认能力；点击后推进基线，后续变更重新累计。

## Context

用户与 Agent 对话后，Agent 可能会在当前聊天工作区中创建、修改或删除文件。现有界面只能从 Agent 文本与工具步骤推测发生了哪些代码变更，用户无法在继续输入下一条消息前快速确认当前会话累计产生了哪些文件变更。

本功能在聊天输入框上方展示“当前会话工作区相对上次提交按钮基线的累计变更”列表：

- 每行代表一个文件。
- 新增文件使用绿色边框。
- 修改文件使用蓝色边框，并显示新增行数与删除行数。
- 删除文件使用红色边框。
- 每行可展开查看该文件 diff，但删除文件与过长 diff 不允许展开。
- 面板跟随当前会话切换，展示该会话工作区相对 AgentHub 管理 checkpoint ref 的累计变更。
- 面板右侧提供“提交”按钮；后端会提交当前可见未提交变更（如果存在）并推进 checkpoint，前端重新获取 diff，此时通常为空。

该方案不按单次 turn/run 记录基线，而是维护每个会话自己的 git checkpoint ref。这样实现比逐 turn 基线简单，同时能覆盖群聊内部已经产生 merge commit 的情况：只要还没点击提交按钮，面板仍会展示 checkpoint 之后的累计变更。

## Model

新增共享类型，放在 `packages/shared/src/workspace-diff.ts` 并从 `packages/shared/src/index.ts` 导出。

```ts
export type WorkspaceDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'other'

export interface WorkspaceDiffFile {
  path: string
  oldPath?: string | null
  status: WorkspaceDiffFileStatus
  additions: number
  deletions: number
  diff: string | null
  expandable: boolean
  tooLarge: boolean
}

export interface WorkspaceDiffSummary {
  id: string
  scope: 'agent-chat' | 'group-chat'
  ownerId: string
  baseRef: string | null
  headRef: string | null
  clean: boolean
  files: WorkspaceDiffFile[]
  generatedAt: string
}

export interface WorkspaceCommitPayload {
  message?: string
}

export interface WorkspaceCommitResult {
  committed: boolean
  commitHash: string | null
  message: string | null
  diff: WorkspaceDiffSummary
}
```

后端 DTO 与服务模型保持同形：

- `WorkspaceDiffFileDto`
- `WorkspaceDiffSummaryDto`
- `WorkspaceCommitDto`
- `WorkspaceCommitResultDto`

前端展示模型直接使用 shared 类型，不在聊天消息类型中混入该结构。

## Backend API

新增 API 由后端按会话资源暴露，前端在选择会话、turn/run 完成后、提交成功后拉取对应结果。

| Method | Path                                     | 说明                                                      |
| ------ | ---------------------------------------- | --------------------------------------------------------- |
| `GET`  | `/agent-chats/:chatId/workspace-diff`    | 获取单 Agent 聊天工作区相对 checkpoint 的累计变更         |
| `POST` | `/agent-chats/:chatId/workspace-commit`  | 提交/确认单 Agent 聊天工作区当前累计变更并推进 checkpoint |
| `GET`  | `/group-chats/:groupId/workspace-diff`   | 获取群聊共享工作区相对 checkpoint 的累计变更              |
| `POST` | `/group-chats/:groupId/workspace-commit` | 提交/确认群聊共享工作区当前累计变更并推进 checkpoint      |

接口行为：

- 如果会话不属于当前用户，返回 `NOT_FOUND`。
- 如果当前会话有正在运行的 turn/run，`GET` 仍可返回当前快照；`POST workspace-commit` 返回 busy/conflict，避免提交半写入状态。
- 如果当前工作区不是 git 仓库，后端尝试 `git init -b main` 并配置本地提交身份；没有初始提交时，当前文件作为未跟踪文件出现在 diff 中。
- 如果没有未提交变更但存在 checkpoint 之后的已提交变更（例如群聊内部 merge commit），提交接口返回 `committed: false` 并仅推进 checkpoint。
- 如果没有任何累计变更，提交接口返回 `committed: false`，不创建空提交。
- 如果 git 命令失败，返回空列表并记录日志，不阻塞 Agent 正常对话。

## Runtime Flow

### 单 Agent 聊天

1. `POST /agent-chats/:chatId/converse` 启动 turn。
2. Agent 运行过程中照常产出 SSE 事件与消息历史。
3. 前端选择该会话时调用 `GET /agent-chats/:chatId/workspace-diff`，展示 checkpoint 之后的累计变更。
4. 前端收到 `AgentEvent.done` 后重新调用该 GET 接口，刷新变更面板。
5. 用户点击提交时调用 `POST /agent-chats/:chatId/workspace-commit`。
6. 后端确认会话空闲后提交可见未提交变更并推进 checkpoint，返回提交后的 diff 快照。
7. `ChatView` 把结果缓存到当前 session key，并传给 `MessageInput`。

### 群聊

1. `POST /group-chats/:groupId/converse` 启动 group run。
2. 成员任务仍按现有 worktree/merge 流程执行。
3. 前端选择该群聊时调用 `GET /group-chats/:groupId/workspace-diff`，展示共享工作区 checkpoint 之后的累计变更。
4. 前端收到 `GroupRunEvent.done` 后重新调用该 GET 接口。
5. 用户点击提交时调用 `POST /group-chats/:groupId/workspace-commit`。
6. 后端确认群聊没有 active run 后提交可见未提交变更并推进 checkpoint，返回提交后的 diff 快照。

### Diff 生成规则

后端新增 `WorkspaceDiffService`，统一处理单聊与群聊：

- 每个会话维护一个 `refs/agenthub/workspace-diff/<scope>/<ownerId>` checkpoint ref；新建会话时初始化为当前 `HEAD`（若存在）。
- 执行 `git diff <checkpoint>` 与 `git status --porcelain -z` 汇总文件状态；无 checkpoint 时回退到当前工作树状态。
- tracked 修改用 `git diff <checkpoint> -- <path>` 生成 patch。
- 新增/未跟踪文件用 `git diff --no-index /dev/null <path>` 或等价方案生成 patch。
- 删除文件只展示红色摘要，不返回可展开 diff。
- 单文件 diff 超过 400 行或 80KB 时标记 `tooLarge: true`、`expandable: false`、`diff: null`。
- 忽略 AgentHub 运行态目录，如 `.agenthub/`、`.codex/`、`.claude/`、`.agents/`、`ACTIVE`。
- 提交时执行 `git add -A`，再次确认 staged diff 非空；若非空则 `git commit -m <message>`；无 staged diff 时只推进 checkpoint。
- 默认提交信息为 `chore: save workspace changes`，前端本版本不提供编辑提交信息的输入框。

### Frontend UI

新增 `WorkspaceDiffPanel.vue`：

- 放在 `MessageInput.vue` 中，位置在 reply 引用条与文本输入区域上方。
- 文件条使用紧凑的工作台风格，不使用嵌套卡片。
- 面板标题显示“工作区变更”和文件数量；右侧显示刷新按钮与提交按钮。
- 颜色语义：
  - added/untracked：绿色边框。
  - modified/renamed/other：蓝色边框。
  - deleted：红色边框。
- 修改文件显示 `+N -M`。
- 可展开行提供图标按钮；删除文件与 `tooLarge` 文件显示不可展开状态说明。
- diff 内容使用等宽字体、水平滚动、`+`/`-` 行轻量着色。
- 提交中禁用提交按钮，提交失败在面板内显示简短错误。

## Validation

- 后端单元测试：
  - 新增文件识别为绿色语义的 `added`/`untracked`，包含新增行数。
  - 修改文件识别为 `modified`，包含 additions/deletions 和 diff。
  - 删除文件识别为 `deleted`，`expandable` 为 `false`。
  - 超长 diff 被标记为 `tooLarge` 且不返回 diff 文本。
  - 有未提交变更时提交返回 `committed: true` 和 commit hash；提交后 diff 为空。
  - 只有 checkpoint 之后的已提交变更时提交返回 `committed: false`，但推进 checkpoint 后 diff 为空。
  - 无累计变更时提交返回 `committed: false`。
- 前端验证：
  - `pnpm -F @agenthub/desktop typecheck`
  - 面板在有变更、无变更、超长 diff、删除文件四种状态下渲染正常。
- 集成验证：
  - 启动一次单 Agent turn，完成后输入框上方出现当前累计变更。
  - 点击提交后，面板重新拉取并清空。
  - 启动一次群聊 run，成员合并回共享工作区后出现当前累计变更。

## Known Limits

- 本版本展示当前会话工作区相对 AgentHub checkpoint 的累计变更，不区分是哪一次 Agent turn/run 产生的。
- 本版本不提供提交信息编辑输入框，提交按钮使用默认提交信息。
- 对二进制文件只展示摘要，不展示内容 diff。
- 删除文件不展开 diff，避免大段删除内容挤占输入区空间。
- 超过 400 行或 80KB 的单文件 diff 不展开，只展示文件状态和行数。
- 群聊的“本次变更”以共享工作区最终结果为准，不展示每个成员 worktree 内部的中间 diff。
