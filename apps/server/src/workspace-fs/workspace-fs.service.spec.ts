import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../common/index.js'
import { WorkspaceFsService } from './workspace-fs.service.js'

test('WorkspaceFsService lists directories under configured roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    await mkdir(join(root, 'project-a'))
    await mkdir(join(root, 'project-b'))
    const service = new WorkspaceFsService(new ConfigService({ AGENTHUB_WORKSPACE_ROOTS: root }))

    const roots = await service.roots()
    const realRoot = await realpath(root)
    assert.equal(roots.length, 1)
    assert.equal(roots[0].path, realRoot)

    const listing = await service.listDirectories(root)
    assert.equal(listing.path, realRoot)
    assert.deepEqual(
        listing.entries.map((entry) => entry.name),
        ['project-a', 'project-b']
    )
})

test('WorkspaceFsService rejects paths outside configured roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-fs-'))
    const outside = await mkdtemp(join(tmpdir(), 'agenthub-workspace-outside-'))
    const service = new WorkspaceFsService(new ConfigService({ AGENTHUB_WORKSPACE_ROOTS: root }))

    await assert.rejects(
        () => service.listDirectories(outside),
        (err: unknown) =>
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            err.code === ErrorCode.FORBIDDEN
    )
})
