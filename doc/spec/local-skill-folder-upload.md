# Local Skill Folder Upload

> 允许桌面端在新建或编辑 Agent 时选择用户本地 skill 文件夹，并上传到后端当前用户的 `skills` 根目录。

## Context

当前 Agent 表单的 Skill Folders 只能通过服务器目录选择器选择后端用户空间中的目录。桌面端运行在用户本机，应该支持选择本地文件夹；选中后先上传到服务器为当前用户分配的 `skills` 目录，再把服务器端目录路径写入 `skillSourceDirectories`，沿用现有 Agent 创建/更新导入逻辑。

## Model

新增 shared contract：

- `LocalSkillFolderFile`：本地文件夹内单个文件的相对路径、base64 内容和字节数。
- `ImportLocalSkillFolderPayload`：上传的本地目录名与文件清单。
- `ImportedSkillFolderView`：后端落盘后的服务器目录路径、导入出来的 skill 名称和写入文件数。

后端不新增数据库实体；上传内容直接写入当前用户 workspace 的 `skills/<folderName>` 目录。

## Backend API

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/workspace-fs/skills/import-local` | 接收本地 skill 文件夹文件清单，写入当前用户服务器 `skills` 目录，并返回服务器目录路径 |

## Runtime Flow

1. 用户在 Agent 表单点击“选择本地目录”。
2. Electron 主进程打开本地目录选择器，递归读取目录文件，跳过隐藏的依赖/构建目录和超限文件。
3. Renderer 调用 `POST /workspace-fs/skills/import-local` 上传文件清单。
4. 后端验证路径不可穿越、总大小和文件数量不超限，要求目录可被现有 skill 解析逻辑识别为单个 skill 或 skills 根目录。
5. 后端写入当前用户 `skills` root 下的安全目录名，返回该服务器目录。
6. 表单把返回目录追加到 `skillSourceDirectories`，并把返回的 skill 名称追加到 Enabled Skills。
7. Agent 创建/更新时仍调用原有 `skillSourceDirectories` 导入到 Agent Home 的 vendor skills 目录。

## Validation

- 后端单元测试覆盖本地 skill 文件夹写入、路径穿越拒绝、重复目标目录拒绝。
- 运行 desktop 与 server typecheck，确保新增 contract 和 IPC API 类型一致。

## Known Limits

- 当前上传入口覆盖“本地目录 -> 后端用户 skills root”的导入，不支持删除或覆盖服务器已有同名目录。
- 为避免依赖压缩包库，桌面端以 JSON 文件清单上传；大目录受文件数量、单文件大小和总大小限制。
