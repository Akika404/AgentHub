# Local Skill Folder Upload Plan

## Scope

让 Agent 创建/编辑表单支持选择用户本地 skill 文件夹，上传到后端当前用户的 `skills` root，并复用现有 `skillSourceDirectories` 导入 Agent Home 的逻辑。

## Steps

1. Shared contract
   - 在 `packages/shared/src/workspace-fs.ts` 增加 `LocalSkillFolderFile`、`ImportLocalSkillFolderPayload`、`ImportedSkillFolderView`。

2. Backend
   - 在 `UserWorkspaceService` 增加当前用户 `skills` root 的公开分配/查询方法。
   - 在 `WorkspaceFsService` 增加 `importLocalSkillFolder`，负责安全目录名、文件数量/大小限制、路径穿越校验、写入文件、skill 元数据检测。
   - 在 `WorkspaceFsController` 增加 `POST /workspace-fs/skills/import-local`。
   - 在 `workspace-fs-response.dto.ts` 增加 Swagger DTO。
   - 补充 `workspace-fs.service.spec.ts` 测试。

3. Desktop main/preload
   - 在 Electron main 增加 `dialog:import-local-skill-folder` IPC：选择本地目录后递归读取文件，返回 shared payload。
   - 在 preload 类型声明暴露该方法。

4. Desktop renderer
   - 在 `workspace-fs.ts` API 增加 `importLocalSkillFolder`。
   - 在 `AgentCreateDialog.vue` 的 Skill Folders 增加本地目录按钮；上传成功后追加服务器目录与 enabled skill 名称。

5. Validation
   - 运行 `pnpm -F @agenthub/server typecheck`。
   - 运行 `pnpm -F @agenthub/server test -- workspace-fs.service.spec.ts` 或等效最小测试。
   - 运行 `pnpm -F @agenthub/desktop typecheck`。
