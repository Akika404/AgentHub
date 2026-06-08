# 聊天列表搜索、归档与跨端置顶

> 模块范围：桌面端聊天列表与单聊/群聊会话状态持久化。

## Context

聊天列表需要支持按关键字搜索、归档聊天、以及跨平台一致的置顶状态。置顶不能再依赖桌面端本地存储，而应由后端数据库保存；归档后聊天仍可打开查看历史，但聊天输入区显示“已归档”，不允许再发起新的单聊 turn 或群聊 run。

## Model

- `agent_session`
  - 新增 `isPinned: boolean`，表示用户单聊是否置顶。
  - 新增 `archivedAt: datetime | null`，为空表示未归档，非空表示已归档。
- `group_chat`
  - 新增 `isPinned: boolean`，表示群聊是否置顶。
  - 新增 `archivedAt: datetime | null`，记录归档时间；同时继续维护现有 `status=active/archived`。
- `AgentChatView`
  - 新增 `isPinned: boolean`。
  - 新增 `archivedAt: string | null`。
- `GroupChatView`
  - 新增 `isPinned: boolean`。
  - 新增 `archivedAt: string | null`。

## Backend API

| Method  | Path                   | 说明                                                |
| ------- | ---------------------- | --------------------------------------------------- |
| `PATCH` | `/agent-chats/:chatId` | 更新单聊列表状态：`{ isPinned?, archived? }`        |
| `PATCH` | `/group-chats/:id`     | 在既有群聊更新接口中支持 `{ isPinned?, archived? }` |

`archived: true` 写入归档状态；`archived: false` 取消归档。已归档聊天的 `converse` 请求由服务端拒绝，避免多端或绕过前端时继续输入。

## Runtime Flow

- 搜索聊天：桌面端在当前已加载的单聊与群聊列表中按标题、预览、类型、Agent 名称/模型、群成员与项目元信息做本地过滤。
- 置顶聊天：右键聊天列表项，选择置顶/取消置顶，前端调用后端 `PATCH`，用返回视图刷新本地状态。列表按置顶优先、更新时间倒序排序。
- 归档聊天：右键聊天列表项，选择归档/取消归档，前端调用后端 `PATCH`，用返回视图刷新本地状态。已归档聊天仍可查看历史，但输入框显示“已归档”并禁用发送、选项回复与提问回复。

## Validation

- `pnpm typecheck`
- `pnpm -F @agenthub/server typecheck`
- `pnpm -F @agenthub/desktop typecheck`

## Known Limits

- 搜索为桌面端本地过滤，不额外请求后端，也不搜索历史消息正文。
- 归档不删除聊天、不停止已经在运行中的 turn/run；它只阻止新的输入。
