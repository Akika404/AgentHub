# 统一聊天列表与群聊资料页

> 桌面端 renderer 功能改造，涉及 `apps/desktop/src/renderer/src/views` 与 `components`。

## Context

当前单 Agent 聊天入口和群聊入口分离：第一个聊天列表只显示单聊，群聊页承担群聊列表、消息对话和黑板侧栏。改造后：

- 第一个聊天列表同时显示单聊和群聊。
- 群聊列表项显示“群聊”小标签。
- 群聊头像使用成员 Agent 头像拼接，接近微信群头像。
- 群聊页改为资料浏览页：左侧显示所有群聊，右侧显示群成员、项目目标、黑板等信息。

## Model

不新增后端模型，也不修改共享 API contract。

前端本地新增联合会话列表项概念：

- `agent:<chatId>`：单 Agent 聊天列表 key。
- `group:<groupId>`：群聊列表 key。

群聊头像使用 `GroupMemberView[]` 中的 `name`、`avatar`、`color` 渲染，不需要后端额外返回头像合成图。

## Backend API

使用现有 API。

| Method | Path                          | 说明                   |
| ------ | ----------------------------- | ---------------------- |
| `GET`  | `/agent-chats`                | 获取单聊列表           |
| `GET`  | `/agent-chats/:id/messages`   | 获取单聊消息           |
| `POST` | `/agent-chats/:id/converse`   | 单聊发送消息并订阅运行 |
| `GET`  | `/group-chats`                | 获取群聊列表           |
| `GET`  | `/group-chats/:id/messages`   | 获取群聊消息           |
| `POST` | `/group-chats/:id/converse`   | 群聊发送任务并订阅运行 |
| `GET`  | `/group-chats/:id/blackboard` | 获取群聊黑板           |

## Runtime Flow

1. 进入聊天页时并行加载单聊、群聊、Agent 列表。
2. 合并生成聊天列表，按置顶优先、更新时间倒序展示。
3. 选择单聊时使用现有单聊消息、运行订阅、右侧 Agent inspector。
4. 选择群聊时加载群聊详情、消息和黑板；发送消息走群聊 converse API。
5. 群聊运行期间列表项显示运行态，消息与黑板在关键事件后刷新。
6. 群聊页只负责资料浏览：左侧群聊列表，右侧展示成员、目标、工作区、Orchestrator 和黑板摘要。

## Validation

- `pnpm typecheck`
- 手动在桌面端验证：
  - 单聊和群聊同时出现在第一个聊天列表。
  - 群聊项有“群聊”标签。
  - 群聊头像由成员头像/首字拼接。
  - 群聊页不再显示聊天输入区，右侧显示资料与黑板。

## Known Limits

- 群聊头像在前端实时拼接，不生成持久化图片。
- 群聊消息回复引用暂不持久化到群聊后端；群聊发送只提交文本。
- 本次不处理旧置顶 localStorage key 的迁移。
