import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { GroupWorkspaceService } from './group-workspace.service.js'

test('GroupWorkspaceService preserves non-ASCII artifact paths from git diff', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-group-workspace-'))
    t.after(() => rm(root, { recursive: true, force: true }))

    const workspace = join(root, '项目工作区')
    const service = new GroupWorkspaceService(
        new ConfigService({ GROUP_WORKSPACE_ROOT: join(root, 'groups') })
    )
    const repo = await service.createWorkspace('group-1', workspace)
    const worktree = await service.createTaskWorktree('group-1', 'task-1', repo)

    await mkdir(join(worktree, '文档'), { recursive: true })
    await writeFile(join(worktree, '文档', '测试报告.md'), '# 测试报告\n', 'utf8')

    const changed = await service.diffArtifacts('group-1', 'task-1', repo)

    assert.deepEqual(changed, [{ status: 'A', path: '文档/测试报告.md' }])
})
