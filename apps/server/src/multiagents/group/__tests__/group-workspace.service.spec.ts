import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { GroupWorkspaceService } from '../group-workspace.service.js'

const execFileAsync = promisify(execFile)

function makeConfig(root: string) {
    return {
        get: (key: string) => (key === 'GROUP_WORKSPACE_ROOT' ? root : undefined)
    }
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    return stdout
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path)
        return true
    } catch {
        return false
    }
}

describe('GroupWorkspaceService', () => {
    test('uses user-provided workspaceDir as the shared git repo', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agenthub-root-'))
        const custom = await mkdtemp(join(tmpdir(), 'agenthub-custom-'))

        const service = new GroupWorkspaceService(makeConfig(root) as any)
        try {
            const repo = await service.createWorkspace('g-custom', custom)
            assert.equal(repo, resolve(custom))
            assert.equal(
                await realpath((await git(custom, ['rev-parse', '--show-toplevel'])).trim()),
                await realpath(custom)
            )
        } finally {
            await rm(custom, { recursive: true, force: true })
            await rm(root, { recursive: true, force: true })
        }
    })

    test('removeWorkspace only flips ACTIVE=false for user-provided shared repo', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agenthub-root-'))
        const custom = await mkdtemp(join(tmpdir(), 'agenthub-custom-'))

        const service = new GroupWorkspaceService(makeConfig(root) as any)
        try {
            await service.createWorkspace('g-keep', custom)
            assert.equal(await readFile(join(custom, 'ACTIVE'), 'utf8'), 'true\n')

            await service.removeWorkspace('g-keep', custom)

            assert.equal(await exists(custom), true)
            assert.equal(await readFile(join(custom, 'ACTIVE'), 'utf8'), 'false\n')
        } finally {
            await rm(custom, { recursive: true, force: true })
            await rm(root, { recursive: true, force: true })
        }
    })

    test('removeWorkspace keeps default allocated directories and flips ACTIVE=false', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agenthub-root-'))
        const service = new GroupWorkspaceService(makeConfig(root) as any)
        try {
            const repo = await service.createWorkspace('g-default')
            assert.equal(await readFile(join(repo, 'ACTIVE'), 'utf8'), 'true\n')

            await service.removeWorkspace('g-default')

            assert.equal(await exists(join(root, 'g-default')), true)
            assert.equal(await exists(repo), true)
            assert.equal(await readFile(join(repo, 'ACTIVE'), 'utf8'), 'false\n')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
