import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, realpath, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../common/index.js'
import { UserWorkspaceService } from './user-workspace.service.js'

function serviceFor(root: string): UserWorkspaceService {
    return new UserWorkspaceService(new ConfigService({ AGENTHUB_USER_SPACE_ROOT: root }))
}

function isForbidden(err: unknown): boolean {
    return (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === ErrorCode.FORBIDDEN
    )
}

test('UserWorkspaceService creates the per-user directory layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const realRoot = await realpath(root)
    const service = serviceFor(root)

    const paths = await service.ensureUserWorkspace('user-a')
    assert.equal(paths.userRoot, join(realRoot, 'user-a'))
    assert.equal(paths.skillsRoot, join(realRoot, 'user-a', 'skills'))
    assert.equal(paths.sessionRoot, join(realRoot, 'user-a', 'session'))
    assert.equal(paths.agentHomeRoot, join(realRoot, 'user-a', 'agent_home'))
    assert.equal(paths.agentWorkspaceRoot, join(realRoot, 'user-a', 'agent_workspace'))

    const roots = await service.browsableRoots('user-a')
    assert.deepEqual(
        roots.map((entry) => entry.kind),
        ['skills', 'agent_home', 'agent_workspace']
    )
})

test('UserWorkspaceService allocates runtime paths in the correct user roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const realRoot = await realpath(root)
    const service = serviceFor(root)

    assert.equal(
        await service.allocateAgentHomeDirectory('user-a', 'agent-1'),
        join(realRoot, 'user-a', 'agent_home', 'agent-1')
    )
    assert.equal(
        await service.allocateChatWorkspaceDirectory('user-a', 'session-1'),
        join(realRoot, 'user-a', 'agent_workspace', 'chat-session-1')
    )
    assert.equal(
        await service.allocateSessionHomeDirectory('user-a', 'session-1'),
        join(realRoot, 'user-a', 'session', 'session-1')
    )
    assert.equal(
        await service.allocateGroupWorkspaceDirectory('user-a', 'group-1'),
        join(realRoot, 'user-a', 'agent_workspace', 'group-group-1')
    )
})

test('UserWorkspaceService rejects paths outside the requested root kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const service = serviceFor(root)
    const paths = await service.ensureUserWorkspace('user-a')

    await assert.rejects(
        () =>
            service.assertPathInRoot(
                'user-a',
                'agent_workspace',
                join(paths.agentHomeRoot, 'agent-1')
            ),
        isForbidden
    )
    await assert.rejects(
        () => service.assertSkillSourceDirectories('user-a', [join(paths.agentWorkspaceRoot, 's')]),
        isForbidden
    )
})

test('UserWorkspaceService rejects another user path and symlink escapes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-outside-'))
    const service = serviceFor(root)
    const userA = await service.ensureUserWorkspace('user-a')
    const userB = await service.ensureUserWorkspace('user-b')
    await mkdir(join(outside, 'project'))
    await symlink(outside, join(userA.agentWorkspaceRoot, 'linked-outside'))

    await assert.rejects(
        () =>
            service.assertPathInRoot(
                'user-a',
                'agent_workspace',
                join(userB.agentWorkspaceRoot, 'project')
            ),
        isForbidden
    )
    await assert.rejects(
        () =>
            service.assertPathInRoot(
                'user-a',
                'agent_workspace',
                join(userA.agentWorkspaceRoot, 'linked-outside', 'project')
            ),
        isForbidden
    )
})

test('UserWorkspaceService rejects a user root symlink outside the configured root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-outside-'))
    const service = serviceFor(root)
    await symlink(outside, join(root, 'user-a'))

    await assert.rejects(() => service.ensureUserWorkspace('user-a'), isForbidden)
})

test('UserWorkspaceService rejects user root and kind root symlinks that swap identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const service = serviceFor(root)
    const userB = await service.ensureUserWorkspace('user-b')
    await symlink(userB.userRoot, join(root, 'user-a'))

    await assert.rejects(() => service.ensureUserWorkspace('user-a'), isForbidden)

    const secondRoot = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const secondService = serviceFor(secondRoot)
    const paths = await secondService.ensureUserWorkspace('user-a')
    const thirdRoot = await mkdtemp(join(tmpdir(), 'agenthub-user-space-'))
    const thirdService = serviceFor(thirdRoot)
    await mkdir(join(thirdRoot, 'user-a'), { recursive: true })
    await symlink(paths.agentWorkspaceRoot, join(thirdRoot, 'user-a', 'skills'))

    await assert.rejects(() => thirdService.ensureUserWorkspace('user-a'), isForbidden)
})
