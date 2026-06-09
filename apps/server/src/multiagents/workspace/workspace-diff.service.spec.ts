import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { WorkspaceDiffService } from './workspace-diff.service.js'

const execFileAsync = promisify(execFile)

test('WorkspaceDiffService summarizes and commits visible workspace changes', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-diff-'))
    t.after(() => rm(root, { recursive: true, force: true }))

    const service = new WorkspaceDiffService()
    await writeFile(join(root, 'tracked.txt'), 'alpha\n', 'utf8')
    await writeFile(join(root, 'delete-me.txt'), 'remove me\n', 'utf8')
    await service.commit(root, 'agent-chat', 'chat-1', { message: 'chore: initial' })

    await writeFile(join(root, 'tracked.txt'), 'alpha\nbeta\n', 'utf8')
    await writeFile(join(root, 'new.txt'), 'new file\n', 'utf8')
    await unlink(join(root, 'delete-me.txt'))
    await mkdir(join(root, '.codex'), { recursive: true })
    await writeFile(join(root, '.codex', 'runtime.json'), '{}\n', 'utf8')

    const diff = await service.summarize(root, 'agent-chat', 'chat-1')
    const byPath = new Map(diff.files.map((file) => [file.path, file]))

    assert.equal(diff.clean, false)
    assert.deepEqual(diff.files.map((file) => file.path).sort(), [
        'delete-me.txt',
        'new.txt',
        'tracked.txt'
    ])
    assert.equal(byPath.get('new.txt')?.status, 'untracked')
    assert.equal(byPath.get('new.txt')?.additions, 1)
    assert.equal(byPath.get('new.txt')?.expandable, true)
    assert.equal(byPath.get('tracked.txt')?.status, 'modified')
    assert.equal(byPath.get('tracked.txt')?.additions, 1)
    assert.equal(byPath.get('delete-me.txt')?.status, 'deleted')
    assert.equal(byPath.get('delete-me.txt')?.expandable, false)

    const committed = await service.commit(root, 'agent-chat', 'chat-1', {
        message: 'feat: save visible changes'
    })
    assert.equal(committed.committed, true)
    assert.equal(typeof committed.commitHash, 'string')
    assert.equal(committed.diff.clean, true)

    const noChanges = await service.commit(root, 'agent-chat', 'chat-1')
    assert.equal(noChanges.committed, false)
    assert.equal(noChanges.commitHash, null)
    assert.equal(noChanges.diff.clean, true)
})

test('WorkspaceDiffService shows committed changes until checkpoint advances', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-workspace-diff-'))
    t.after(() => rm(root, { recursive: true, force: true }))

    const service = new WorkspaceDiffService()
    await writeFile(join(root, 'README.md'), '# Project\n', 'utf8')
    await service.commit(root, 'group-chat', 'group-1', { message: 'chore: initial' })

    await writeFile(join(root, 'feature.md'), 'implemented\n', 'utf8')
    await execFileAsync('git', ['add', 'feature.md'], { cwd: root })
    await execFileAsync('git', ['commit', '-m', 'task: internal member change'], { cwd: root })

    const diff = await service.summarize(root, 'group-chat', 'group-1')
    assert.equal(diff.clean, false)
    assert.equal(diff.files.length, 1)
    assert.equal(diff.files[0].path, 'feature.md')
    assert.equal(diff.files[0].status, 'added')

    const checkpointOnly = await service.commit(root, 'group-chat', 'group-1')
    assert.equal(checkpointOnly.committed, false)
    assert.equal(checkpointOnly.diff.clean, true)
})
