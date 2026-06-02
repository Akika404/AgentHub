# 消息卡片设计文档

本文档描述桌面端聊天流当前支持的消息卡片类型、每种卡片的功能交互，以及它们接受的数据格式。

## 总览

当前聊天流共有 5 种消息卡片：

| 卡片类型           | `kind`      | 组件                  | 数据来源                         |
| ------------------ | ----------- | --------------------- | -------------------------------- |
| 系统消息卡片       | `system`    | `SystemMessage.vue`   | 后端/Mock 历史消息               |
| 文本消息卡片       | `text`      | `TextMessage.vue`     | 后端/Mock 历史消息、用户发送消息 |
| 任务列表消息卡片   | `task-list` | `TaskListMessage.vue` | 后端/Mock 历史消息               |
| 选项消息卡片       | `options`   | `OptionsMessage.vue`  | 后端/Mock 历史消息               |
| Agent 运行回复卡片 | `agent-run` | `AgentRunMessage.vue` | 前端运行时流式事件聚合           |

聊天列表实际渲染的数据类型是 `ChatDisplayMessage`：

```ts
type ChatDisplayMessage = ChatMessage | AgentRunMessage
type ChatMessage = SystemMessage | TextMessage | TaskListMessage | OptionsMessage
```

其中 `ChatMessage` 是共享协议里的历史消息格式；`AgentRunMessage` 是前端显示层消息，用于把 agent 的思考、工具调用和最终回复展示在同一个气泡里。

## 公共交互

除加载骨架屏外，每条消息都会由 `MessageList.vue` 包裹在一个可交互的消息容器中。

公共交互包括：

- 右键菜单：支持 `Pin消息/取消Pin`、`复制`、`回复`。
- Pin：被 Pin 的消息在聊天流左侧显示 Pin 标识，并进入顶部 `PinnedBar.vue`。
- 复制：复制该消息转换后的纯文本内容。
- 回复：把消息发送者和内容摘要填入输入框上方的回复引用区。
- 跳转：从 `PinnedBar.vue` 点击消息时滚动到原消息位置，并短暂高亮。
- 自动滚动：消息数量变化、最后一条文本增长、或 `agent-run` 状态变化时滚动到底部。

## 公共字段

历史消息共享以下基础字段：

```ts
interface BaseMessage {
  id: string
  chatId: string
  timestamp: string
  pinned?: boolean
}
```

带发送者的消息使用：

```ts
interface SenderInfo {
  id: string
  name: string
  role: 'user' | 'orchestrator' | 'agent' | 'system'
  icon?: string
  initials?: string
  accent?: 'primary' | 'violet' | 'green' | 'neutral'
  color?: string
  avatarDataUrl?: string
}
```

## 系统消息卡片

组件：`apps/desktop/src/renderer/src/components/messages/SystemMessage.vue`

用途：

- 展示系统提示、错误提示、流式异常等非某个用户或 agent 发送的消息。
- 在聊天流中居中显示，使用较轻量的胶囊样式。

交互：

- 支持公共右键菜单。
- 复制内容为 `text`。
- 回复时发送者名称显示为 `系统`。

接受格式：

```ts
interface SystemMessage extends BaseMessage {
  kind: 'system'
  text: string
}
```

示例：

```json
{
  "id": "m-system-1",
  "chatId": "chat-1",
  "kind": "system",
  "timestamp": "2026-06-02T10:00:00.000Z",
  "text": "Stream error: connection closed"
}
```

## 文本消息卡片

组件：`apps/desktop/src/renderer/src/components/messages/TextMessage.vue`

用途：

- 展示用户消息和普通 agent 文本回复。
- 用户消息靠右显示，agent/其他发送者消息靠左显示。
- 支持多行文本和保留换行。

交互：

- 支持公共右键菜单。
- 支持 Pin、复制、回复。
- 当 `replyTo` 存在时，在气泡顶部显示被回复消息的发送者和摘要。

接受格式：

```ts
interface MessageReplyRef {
  messageId: string
  senderName: string
  excerpt: string
}

interface TextMessage extends BaseMessage {
  kind: 'text'
  sender: SenderInfo
  text: string
  replyTo?: MessageReplyRef
}
```

示例：

```json
{
  "id": "m-user-1",
  "chatId": "chat-1",
  "kind": "text",
  "timestamp": "2026-06-02T10:01:00.000Z",
  "sender": {
    "id": "me",
    "name": "我",
    "role": "user",
    "initials": "我",
    "accent": "primary"
  },
  "text": "帮我修改聊天输入框"
}
```

## 任务列表消息卡片

组件：`apps/desktop/src/renderer/src/components/messages/TaskListMessage.vue`

用途：

- 展示 agent 拆解出的任务清单或待办进度。
- 每个任务带状态，适合展示执行计划和阶段性状态。

交互：

- 支持公共右键菜单。
- 复制内容格式为标题加任务列表，例如：

```text
实现聊天输入框修复
- 支持 IME 输入 [done]
- Enter 发送 [done]
- Shift+Enter 换行 [done]
```

接受格式：

```ts
interface TaskItem {
  id: string
  title: string
  status: 'in-progress' | 'pending' | 'done'
}

interface TaskListMessage extends BaseMessage {
  kind: 'task-list'
  sender: SenderInfo
  heading: string
  tasks: TaskItem[]
}
```

示例：

```json
{
  "id": "m-task-1",
  "chatId": "chat-1",
  "kind": "task-list",
  "timestamp": "2026-06-02T10:02:00.000Z",
  "sender": {
    "id": "agent-1",
    "name": "Codex",
    "role": "agent",
    "accent": "neutral"
  },
  "heading": "输入框修复计划",
  "tasks": [
    { "id": "t1", "title": "处理输入法 composition", "status": "done" },
    { "id": "t2", "title": "修复发送后清空", "status": "done" }
  ]
}
```

## 选项消息卡片

组件：`apps/desktop/src/renderer/src/components/messages/OptionsMessage.vue`

用途：

- 展示一组可点击选项。
- 支持用户在选项下方输入自定义回复。
- 常用于 agent 让用户确认方向、选择方案、补充需求。

交互：

- 点击选项：触发 `select-option`，由上层将选项文本作为用户消息发送。
- 自定义输入：输入框内按 Enter 提交，Shift+Enter 对单行输入无特殊效果。
- 输入法兼容：composition 期间 Enter 不提交，发送按钮也会禁用。
- 已回答状态：`answered` 为 `true` 后选项和输入框变为只读/隐藏状态。
- 支持公共右键菜单。

接受格式：

```ts
interface OptionItem {
  id: string
  label: string
  selected?: boolean
}

interface OptionsMessage extends BaseMessage {
  kind: 'options'
  sender: SenderInfo
  text: string
  options: OptionItem[]
  placeholder?: string
  answered?: boolean
  answeredOptionId?: string
}
```

示例：

```json
{
  "id": "m-options-1",
  "chatId": "chat-1",
  "kind": "options",
  "timestamp": "2026-06-02T10:03:00.000Z",
  "sender": {
    "id": "agent-1",
    "name": "Codex",
    "role": "agent",
    "accent": "neutral"
  },
  "text": "你希望输入框采用哪种行为？",
  "options": [
    { "id": "o1", "label": "Enter 发送，Shift+Enter 换行" },
    { "id": "o2", "label": "点击按钮发送" }
  ],
  "placeholder": "也可以输入自定义要求..."
}
```

## Agent 运行回复卡片

组件：`apps/desktop/src/renderer/src/components/messages/AgentRunMessage.vue`

用途：

- 展示一个 agent 回合中的完整运行过程和最终回复。
- 把 `思考 => 调用工具 => 思考 => 生成回复` 放在同一个 agent 消息气泡里。
- 在正文生成前显示当前运行状态；正文生成后，把运行过程折叠在气泡顶部。

运行中展示规则：

- 当前步骤为思考：气泡中显示 3 个上下浮动的点。
- 当前步骤为工具调用：气泡中只显示一行 `正在调用 <toolName>`。
- 多次思考和工具调用会追加到 `steps`，不会因为工具完成而消失。

最终回复展示规则：

- `text` 有内容后，气泡主体展示最终回复文本。
- 气泡顶部显示 `运行过程 · n 步` 折叠条。
- 点击折叠条展开/收起运行过程。
- 展开/收起使用高度、透明度、位移过渡动画。
- 在 `prefers-reduced-motion: reduce` 下关闭折叠动画和点动画。

交互：

- 支持公共右键菜单。
- 支持 Pin、复制、回复。
- 复制时优先复制最终回复 `text`；如果还没有最终回复，则复制运行步骤文本。
- 回复时引用发送者为该 agent，摘要来自最终回复或运行步骤。

接受格式：

```ts
interface AgentRunStep {
  id: string
  type: 'thinking' | 'tool'
  label: string
  status: 'active' | 'completed' | 'failed'
}

interface AgentRunMessage {
  id: string
  chatId: string
  kind: 'agent-run'
  timestamp: string
  pinned?: boolean
  sender: SenderInfo
  status: 'thinking' | 'tool' | 'responding' | 'done' | 'error'
  steps: AgentRunStep[]
  text: string
}
```

示例：

```json
{
  "id": "m-agent-run-1",
  "chatId": "chat-1",
  "kind": "agent-run",
  "timestamp": "2026-06-02T10:04:00.000Z",
  "sender": {
    "id": "agent-1",
    "name": "Codex",
    "role": "agent",
    "accent": "neutral"
  },
  "status": "done",
  "steps": [
    {
      "id": "run-step-thinking-1",
      "type": "thinking",
      "label": "思考中",
      "status": "completed"
    },
    {
      "id": "run-step-tool-1",
      "type": "tool",
      "label": "正在调用 read_file",
      "status": "completed"
    },
    {
      "id": "run-step-thinking-2",
      "type": "thinking",
      "label": "继续思考",
      "status": "completed"
    }
  ],
  "text": "已完成修改。"
}
```

## 流式事件到 Agent 运行回复卡片的映射

`AgentRunMessage` 由 `ChatView.vue` 根据 `AgentEvent` 动态维护：

| 流式事件                             | 卡片变化                                              |
| ------------------------------------ | ----------------------------------------------------- |
| 用户发送消息                         | 创建一条 `agent-run`，初始步骤为 `思考中`             |
| `thinking`                           | 当前步骤变为或保持 `思考中`                           |
| `tool_use` 且 `status === 'started'` | 完成当前 active 步骤，追加 `正在调用 <name>` 工具步骤 |
| `tool_use` completed/failed          | 当前工具步骤标记为 completed/failed                   |
| `tool_result`                        | 当前工具步骤完成；非错误时追加 `继续思考`             |
| `text`                               | 完成当前步骤，把流式文本追加到同一个气泡的 `text`     |
| `turn_completed`                     | 如果存在 `finalText`，同步到 `text`，并完成当前步骤   |
| `done`                               | 标记气泡为 `done` 或 `error`                          |
| stream error                         | 标记气泡为 `error`，并追加系统消息说明错误            |

## 扩展新卡片的约定

新增消息卡片时建议遵循以下步骤：

1. 如果是后端/历史消息，先在 `packages/shared/src/chat.ts` 扩展 `ChatMessage`。
2. 如果只是前端运行态展示，优先放在 `apps/desktop/src/renderer/src/types/chatDisplay.ts`，扩展 `ChatDisplayMessage`。
3. 在 `apps/desktop/src/renderer/src/components/messages/` 下新增对应组件。
4. 在 `MessageList.vue` 中按 `kind` 接入渲染。
5. 在 `ChatView.vue` 中补齐纯文本转换、发送者名称、回复摘要、Pin/复制/回复等交互。
6. 如果卡片内部有输入框，必须处理输入法 composition，避免 Enter 误提交。
