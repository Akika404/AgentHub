import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../common/index.js'
import type { ImportLocalSkillFolderPayload } from '@agenthub/shared'
import { UserWorkspaceService } from '../user-workspace/user-workspace.service.js'
import { AgentWorkspaceService } from '../multiagents/workspace/agent-workspace.service.js'
import { WorkspaceFsService } from './workspace-fs.service.js'

function serviceFor(root: string): WorkspaceFsService {
    return new WorkspaceFsService(
        new UserWorkspaceService(new ConfigService({ AGENTHUB_USER_SPACE_ROOT: root })),
        new AgentWorkspaceService()
    )
}

function manifestFile(payload: ImportLocalSkillFolderPayload): { buffer: Buffer; size: number } {
    const buffer = Buffer.from(JSON.stringify(payload), 'utf8')
    return { buffer, size: buffer.length }
}

function encodedFile(relativePath: string, content: string): ImportLocalSkillFolderPayload['files'][number] {
    const buffer = Buffer.from(content, 'utf8')
    return {
        relativePath,
        contentBase64: buffer.toString('base64'),
        size: buffer.length
    }
}

test('WorkspaceFsService lists only the authenticated user workspace roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const service = serviceFor(root)

    const roots = await service.roots('user-a')
    const realRoot = await realpath(root)
    assert.deepEqual(
        roots.map((entry) => entry.kind),
        ['skills', 'agent_home', 'agent_workspace']
    )
    assert.ok(roots.every((entry) => entry.path.startsWith(join(realRoot, 'user-a'))))
})

test('WorkspaceFsService lists directories inside the current user agent workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const service = serviceFor(root)
    const roots = await service.roots('user-a')
    const workspaceRoot = roots.find((entry) => entry.kind === 'agent_workspace')
    assert.ok(workspaceRoot)
    await mkdir(join(workspaceRoot.path, 'project-a'))
    await mkdir(join(workspaceRoot.path, 'project-b'))

    const listing = await service.listDirectories('user-a', workspaceRoot.path)
    assert.equal(listing.path, workspaceRoot.path)
    assert.equal(listing.root.kind, 'agent_workspace')
    assert.deepEqual(
        listing.entries.map((entry) => entry.name),
        ['project-a', 'project-b']
    )
})

test('WorkspaceFsService rejects another user workspace path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const service = serviceFor(root)
    const userBRoots = await service.roots('user-b')
    const userBWorkspace = userBRoots.find((entry) => entry.kind === 'agent_workspace')
    assert.ok(userBWorkspace)

    await assert.rejects(
        () => service.listDirectories('user-a', userBWorkspace.path),
        (err: unknown) =>
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            err.code === ErrorCode.FORBIDDEN
    )
})

test('WorkspaceFsService imports a local skill folder into the current user skills root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const service = serviceFor(root)

    const imported = await service.importLocalSkillFolder(
        'user-a',
        manifestFile({
            folderName: 'Local Skill',
            files: [
                encodedFile('SKILL.md', '---\nname: local-skill\n---\n# Local Skill\n'),
                encodedFile('scripts/run.sh', '#!/usr/bin/env bash\n')
            ]
        })
    )

    assert.deepEqual(imported.skills, ['local-skill'])
    assert.equal(imported.fileCount, 2)
    assert.ok(imported.directory.startsWith(join(await realpath(root), 'user-a', 'skills')))
    assert.equal(
        await readFile(join(imported.directory, 'SKILL.md'), 'utf8'),
        '---\nname: local-skill\n---\n# Local Skill\n'
    )
})

test('WorkspaceFsService rejects local skill folder path traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const service = serviceFor(root)

    await assert.rejects(
        () =>
            service.importLocalSkillFolder(
                'user-a',
                manifestFile({
                    folderName: 'bad-skill',
                    files: [encodedFile('../SKILL.md', '# Bad\n')]
                })
            ),
        (err: unknown) =>
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            err.code === ErrorCode.FORBIDDEN
    )
})
