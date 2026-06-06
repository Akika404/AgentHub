# 统一聊天列表与群聊资料页 Plan

## 目标

把单聊和群聊统一到聊天页第一个列表中，并把群聊页改成群聊资料与黑板浏览页。

## 实现步骤

1. 新增群聊复合头像组件。
   - 新文件：`apps/desktop/src/renderer/src/components/GroupAvatar.vue`
   - 输入成员头像、名称、颜色。
   - 支持 1 到 9 个成员的网格拼接。

2. 改造聊天列表组件。
   - 文件：`apps/desktop/src/renderer/src/components/ChatList.vue`
   - 群聊项显示 `GroupAvatar`。
   - 群聊标题后显示“群聊”标签。

3. 改造聊天主视图。
   - 文件：`apps/desktop/src/renderer/src/views/ChatView.vue`
   - 并行加载 `agentChatApi.list()` 和 `groupChatApi.list()`。
   - 用 `agent:<id>` / `group:<id>` 作为列表 key。
   - 按会话类型分派消息加载、发送、停止、删除。
   - 群聊发送接入 `groupChatApi.converse()`，群聊事件触发消息和黑板刷新。
   - 群聊创建弹窗留在聊天页内，创建后直接选中新群聊。

4. 新增群聊资料面板。
   - 新文件：`apps/desktop/src/renderer/src/components/GroupDetailPanel.vue`
   - 展示群成员、项目目标、技术栈、状态、工作区、Orchestrator、黑板任务/产出/决策/契约。

5. 改造群聊页。
   - 文件：`apps/desktop/src/renderer/src/views/GroupChatView.vue`
   - 保留左侧所有群聊列表和创建入口。
   - 右侧使用群聊资料面板。
   - 移除原页面内消息列表、消息输入和黑板独立侧栏布局。

6. 更新应用入口。
   - 文件：`apps/desktop/src/renderer/src/App.vue`
   - 第一个聊天列表中的创建群聊由 `ChatView` 自己处理，不再跳转群聊页。

## 验证

- 运行 `pnpm typecheck`。
- 若类型检查通过，再按需启动桌面端 dev server 做视觉检查。
