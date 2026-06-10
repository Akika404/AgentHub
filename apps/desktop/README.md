# @agenthub/desktop

AgentHub 桌面端，标准三进程 **Electron + Vue 3 + TypeScript** 应用，使用 electron-vite 构建，是当前主交付端。

## 进程模型

- `src/main/` — Electron 主进程。创建 `BrowserWindow`、注册 IPC handler、托管本地 runner 与自定义协议。
- `src/preload/` — 上下文桥（`contextBridge`），把受控 API 暴露到渲染层（`window.api`）；新增渲染层可见 API 在这里登记并在 `index.d.ts` 中定型。
- `src/renderer/` — Vue 3 前端，按普通 Vite/Vue 应用对待；只能通过 preload 注入的 `window.api` 访问 Electron 能力。

IPC 模式：renderer 调 `window.api.<method>` → preload 经 `contextBridge` 暴露 → main 用 `ipcMain.handle/on` 处理。
所有后端 REST/SSE/上传都经主进程 `api-proxy` 转发，绕开渲染层 CORS。

构建产物：`out/`（main/preload 编译）与 `out/renderer/`（Vue bundle）。

## 目录结构

```
apps/desktop/
├── electron.vite.config.ts   # electron-vite 配置：externalize node 依赖、Vue 插件、@renderer 别名
├── electron-builder.yml      # 打包配置（mac/win/linux 目标、appId、updater）
├── tailwind.config.js        # Tailwind 主题：自建灰阶、品牌色、字号/圆角/阴影 token
├── postcss.config.js         # PostCSS：tailwindcss + autoprefixer
├── tsconfig.json             # 根 TS 项目，引用 node + web 子配置
├── tsconfig.node.json        # main + preload（Node 侧）TS 配置
├── tsconfig.web.json         # renderer（Vue/web 侧）TS 配置，@renderer 路径别名
├── eslint.config.mjs
├── package.json
├── resources/
│   └── icon.png
└── src/
    ├── main/                            # Electron 主进程
    │   ├── index.ts                     # 主入口：建 BrowserWindow、注册 proxy、目录选择/skill 导入弹窗
    │   ├── api-proxy.ts                 # IPC HTTP 代理：把 REST/stream/upload 转发到后端，绕开 CORS
    │   ├── local-runner.ts              # 本地运行模式：JWT WebSocket runner，拉起本机 Claude Code/Codex CLI
    │   └── preview-protocol.ts          # 自定义 agent-preview:// 协议，带独立 CSP 给 iframe 提供产物 HTML
    ├── preload/
    │   ├── index.ts                     # contextBridge 暴露类型化 window.api（request/upload/stream/弹窗/preview）
    │   └── index.d.ts                   # 暴露的 RendererApi / IPC 请求-响应类型声明
    └── renderer/
        ├── index.html                   # 渲染层宿主页，挂载 Vue 应用
        └── src/
            ├── main.ts                  # Vue 启动：引入 main.css，挂载 App.vue 到 #app
            ├── App.vue                  # 根壳：鉴权门 + GlobalSidebar 在 chat/groups/agents/settings 间导航
            ├── env.d.ts                 # Vite 客户端类型引用
            ├── api/                     # 后端 HTTP/SSE 客户端
            │   ├── http.ts              # 核心请求助手：经 proxy 解信封、抛 ApiError、处理 401
            │   ├── auth.ts              # 用户模块客户端（/api/user/*）：注册/登录/登出/me/update
            │   ├── agents.ts            # Agent + 单聊客户端，含 converse SSE、workspace diff/commit
            │   ├── group-chats.ts       # 群聊客户端：消息/运行/黑板/部署/附件上传与预览 + SSE
            │   ├── providers.ts         # Provider 客户端（/api/platform-providers/*）：CRUD/测连/刷新模型
            │   ├── workspace-fs.ts      # 服务端目录浏览客户端：目录列举、文件预览、skill 上传
            │   ├── mock.ts              # 尚未落地的 chat 模块的内存 mock AgentHubApi
            │   └── index.ts             # API barrel：导出各客户端 + 当前 mock + 重导出 shared 类型
            ├── stores/
            │   └── auth.ts              # 响应式鉴权 store：token/user、localStorage 持久化、login/register/logout
            ├── types/
            │   ├── chatDisplay.ts       # UI 消息/运行步骤展示类型 + 类型守卫（AgentRun/Deploy）
            │   └── mentions.ts          # @-mention 选择器的 MentionTarget 接口
            ├── utils/
            │   ├── agentRunSteps.ts     # 后端 AgentRunStepView → UI AgentRunStep 展示对象
            │   ├── artifactPreview.ts   # 产物内联预览分类：扩展名识别、图标/标签、是否可预览
            │   ├── avatar.ts            # 头像助手：颜色归一、首字母、canvas data-URL 生成
            │   ├── blackboard.ts        # 过滤隐藏黑板产物（.codex/.agents/.claude 目录）
            │   ├── format.ts            # 格式化：ISO 时间 → HH:mm、字节数 → 易读
            │   ├── groupMessage.ts      # GroupMessageView → 聊天气泡展示消息
            │   ├── markdown.ts          # 共享 markdown-it + DOMPurify 渲染器；链接外开
            │   └── vendor.ts            # vendor/model 标签助手（Claude Code vs Codex、本地默认）
            ├── views/
            │   ├── AuthView.vue         # 登录/注册表单（前端校验）
            │   ├── ChatView.vue         # 主单聊：消息列表、流式运行、黑板、diff inspector
            │   ├── GroupChatView.vue    # 群聊工作台：群列表、详情面板、黑板、产物预览
            │   ├── AgentsView.vue       # Agent 管理：列表、创建/编辑/删除、右键菜单
            │   └── SettingsView.vue     # 设置：Provider 列表/详情 + 创建/编辑/删除
            ├── components/              # 通用业务组件
            │   ├── GlobalSidebar.vue        # 左侧导航栏 + UserMenu
            │   ├── ChatList.vue             # 会话列表（置顶/归档、群头像、右键菜单）
            │   ├── ChatHeader.vue           # 聊天头部栏（标题/操作）
            │   ├── MessageList.vue          # 消息流渲染，分发到各类型消息组件
            │   ├── MessageInput.vue         # 输入框：文本、@-mention、文件/图片附件、引用栏
            │   ├── PinnedBar.vue            # 置顶消息条（取消置顶/跳转）
            │   ├── RightInspector.vue       # 右侧检查器：Agent 网络节点、运行阶段、todos
            │   ├── BlackboardSidebar.vue    # 黑板任务/产物侧栏（状态色）
            │   ├── GroupDetailPanel.vue     # 群详情：成员、黑板任务/产物概览
            │   ├── WorkspaceDiffPanel.vue   # 工作区 git diff 概览（刷新/提交）
            │   ├── DeploymentDrawer.vue     # 部署日志/事件抽屉（SSE）
            │   ├── ArtifactPreviewBody.vue  # 产物预览内容（HTML iframe/图片/文本/过大）
            │   ├── ArtifactPreviewDrawer.vue# 拉取并展示产物预览的侧抽屉（群/单聊）
            │   ├── ArtifactPreviewOverlay.vue# 产物预览全屏覆盖层
            │   ├── ServerDirectoryPicker.vue# 浏览/选择服务器工作区目录的弹窗
            │   ├── AgentCreateDialog.vue    # 创建/编辑 Agent 弹窗（vendor/mode/provider/model/头像）
            │   ├── AgentChatCreateDialog.vue# 开单聊弹窗（选 Agent/模型/工作目录）
            │   ├── GroupChatCreateDialog.vue# 建群弹窗（成员/vendor/provider/项目状态）
            │   ├── ProviderList.vue         # 可选 Provider 列表 + 新增
            │   ├── ProviderDetail.vue       # Provider 详情：信息、测连接、刷新模型
            │   ├── ProviderEditDialog.vue   # 创建/编辑 Provider 弹窗（类型/密钥/baseUrl）
            │   ├── AgentAvatar.vue          # Agent 头像（图片或彩色首字母，sm/md/lg）
            │   ├── GroupAvatar.vue          # 群头像（叠放成员头像）
            │   ├── UserMenu.vue             # 用户头像菜单：改昵称/资料、登出
            │   ├── Modal.vue                # 基础弹窗壳（遮罩/标题/ESC 关闭）
            │   ├── ConfirmDialog.vue        # 通用确认弹窗
            │   ├── ContextMenu.vue          # 定位右键上下文菜单
            │   ├── Versions.vue             # 展示 Electron/Chrome/Node 版本
            │   ├── messages/                # 各消息类型渲染组件
            │   │   ├── TextMessage.vue          # 文本气泡（markdown + 附件，自/他对齐）
            │   │   ├── AgentRunMessage.vue      # Agent 运行：步骤（thinking/tool/todo）、markdown、产物
            │   │   ├── AgentQuestionMessage.vue # Agent 提问 + 可选项/自由文本回复
            │   │   ├── OptionsMessage.vue       # 选项提示消息（选择/回复）
            │   │   ├── TaskListMessage.vue      # 任务清单消息
            │   │   ├── DeployMessage.vue        # 部署卡片：产物、预览/编辑/触发部署
            │   │   ├── AttachmentList.vue       # 消息附件列表（文件行 + 图片卡片）
            │   │   ├── SystemMessage.vue        # 居中系统/通知行
            │   │   └── SenderAvatar.vue         # 消息发送者小头像
            │   └── ui/                      # 设计系统 Base 组件（复用，勿手搓）
            │       ├── BaseButton.vue           # 按钮（variant/size/icon/block）
            │       ├── BaseInput.vue            # 文本输入（v-model，mono/invalid）
            │       ├── BaseSelect.vue           # 原生 select 样式封装
            │       ├── BaseTextarea.vue         # 多行文本域
            │       └── BaseSkeleton.vue         # 骨架占位块
            └── assets/
                ├── main.css                # 渲染层入口样式（引 base.css、Tailwind 层、字体）
                ├── base.css                # 基础/全局 CSS reset 与变量
                ├── electron.svg
                └── wavy-lines.svg          # 品牌/登录用装饰背景 SVG
```

## 常用命令

```bash
pnpm -F @agenthub/desktop dev        # electron-vite 开发模式（热重载）
pnpm -F @agenthub/desktop build      # 构建到 out/
pnpm -F @agenthub/desktop start      # 预览生产构建
pnpm -F @agenthub/desktop build:mac  # 打包 macOS（另有 :win / :linux）
pnpm -F @agenthub/desktop typecheck
pnpm -F @agenthub/desktop lint
```

## 设计系统约定

桌面端使用自建 Tailwind token + `components/ui/` Base 组件：复用它们，不要重新引入裸 hex / `text-[Npx]` / 手写按钮。
