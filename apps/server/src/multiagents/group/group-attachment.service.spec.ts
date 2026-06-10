import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigService } from '@nestjs/config'
import type { DataSource, FindOperator, FindOptionsWhere, Repository } from 'typeorm'
import { GroupAttachment } from './entities/group-attachment.entity.js'
import { GroupAttachmentService } from './group-attachment.service.js'
import { GroupWorkspaceService } from './group-workspace.service.js'
import type { GroupChat } from './entities/group-chat.entity.js'

type AttachmentWhere = FindOptionsWhere<GroupAttachment>

class MemoryAttachmentRepo {
    readonly rows = new Map<string, GroupAttachment>()

    create(input: Partial<GroupAttachment>): GroupAttachment {
        return Object.assign(new GroupAttachment(), {
            runId: null,
            workspacePath: null,
            consumedAt: null,
            createdAt: new Date(),
            ...input
        })
    }

    async save(row: GroupAttachment): Promise<GroupAttachment>
    async save(rows: GroupAttachment[]): Promise<GroupAttachment[]>
    async save(
        value: GroupAttachment | GroupAttachment[]
    ): Promise<GroupAttachment | GroupAttachment[]> {
        if (Array.isArray(value)) {
            return Promise.all(value.map((row) => this.saveOne(row)))
        }
        return this.saveOne(value)
    }

    async find(options?: { where?: AttachmentWhere }): Promise<GroupAttachment[]> {
        const where = options?.where ?? {}
        return [...this.rows.values()].filter((row) => this.matches(row, where))
    }

    async delete(where: AttachmentWhere): Promise<void> {
        for (const row of [...this.rows.values()]) {
            if (this.matches(row, where)) this.rows.delete(row.id)
        }
    }

    createQueryBuilder(): {
        setLock: () => ReturnType<MemoryAttachmentRepo['createQueryBuilder']>
        where: (
            clause: string,
            params: Record<string, unknown>
        ) => ReturnType<MemoryAttachmentRepo['createQueryBuilder']>
        andWhere: (
            clause: string,
            params: Record<string, unknown>
        ) => ReturnType<MemoryAttachmentRepo['createQueryBuilder']>
        orderBy: () => ReturnType<MemoryAttachmentRepo['createQueryBuilder']>
        getMany: () => Promise<GroupAttachment[]>
    } {
        const params: Record<string, unknown> = {}
        const builder = {
            setLock: () => builder,
            where: (_clause: string, next: Record<string, unknown>) => {
                Object.assign(params, next)
                return builder
            },
            andWhere: (_clause: string, next: Record<string, unknown>) => {
                Object.assign(params, next)
                return builder
            },
            orderBy: () => builder,
            getMany: async () => {
                const ids = params.ids as string[]
                const userId = params.userId as string
                const groupId = params.groupId as string
                return [...this.rows.values()].filter(
                    (row) =>
                        ids.includes(row.id) && row.userId === userId && row.groupChatId === groupId
                )
            }
        }
        return builder
    }

    private async saveOne(row: GroupAttachment): Promise<GroupAttachment> {
        if (!row.createdAt) row.createdAt = new Date()
        this.rows.set(row.id, row)
        return row
    }

    private matches(row: GroupAttachment, where: AttachmentWhere): boolean {
        return Object.entries(where).every(([key, expected]) => {
            const actual = row[key as keyof GroupAttachment]
            if (this.isFindOperator(expected)) {
                const type = (expected as FindOperator<unknown>)['_type']
                const value = (expected as FindOperator<unknown>)['_value']
                if (type === 'in') return Array.isArray(value) && value.includes(actual)
                if (type === 'isNull') return actual === null || actual === undefined
                if (type === 'lessThan') return actual instanceof Date && actual < (value as Date)
            }
            return actual === expected
        })
    }

    private isFindOperator(value: unknown): value is FindOperator<unknown> {
        return typeof value === 'object' && value !== null && '_type' in value
    }
}

function createService(root: string): {
    service: GroupAttachmentService
    repo: MemoryAttachmentRepo
    group: GroupChat
} {
    const repo = new MemoryAttachmentRepo()
    const workspace = new GroupWorkspaceService(
        new ConfigService({ GROUP_WORKSPACE_ROOT: join(root, 'groups') })
    )
    const dataSource = {
        transaction: async <T>(
            fn: (manager: { getRepository: () => MemoryAttachmentRepo }) => Promise<T>
        ) => fn({ getRepository: () => repo })
    }
    const group = {
        id: 'group-1',
        userId: 'user-1',
        status: 'active',
        archivedAt: null,
        workspaceDir: join(root, 'repo')
    } as GroupChat

    return {
        service: new GroupAttachmentService(
            repo as unknown as Repository<GroupAttachment>,
            workspace,
            dataSource as unknown as DataSource
        ),
        repo,
        group
    }
}

test('GroupAttachmentService rolls back consumed attachments so they can be retried', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-rollback-'))
    const { service, repo, group } = createService(root)

    const uploaded = await service.upload('user-1', group, {
        originalname: '../note.txt',
        mimetype: 'text/plain',
        size: 5,
        buffer: Buffer.from('hello')
    })

    const first = await service.consumeForRun('user-1', group, [uploaded.id], 'run-1')
    assert.equal(first[0]?.workspacePath, 'attachments/run-1/note.txt')
    assert.equal(
        await readFile(join(group.workspaceDir, first[0].workspacePath ?? ''), 'utf8'),
        'hello'
    )

    await service.rollbackForRun('user-1', group, 'run-1')
    const rowAfterRollback = repo.rows.get(uploaded.id)
    assert.equal(rowAfterRollback?.runId, null)
    assert.equal(rowAfterRollback?.workspacePath, null)
    assert.equal(rowAfterRollback?.consumedAt, null)
    await assert.rejects(readFile(join(group.workspaceDir, first[0].workspacePath ?? ''), 'utf8'))

    const retried = await service.consumeForRun('user-1', group, [uploaded.id], 'run-2')
    assert.equal(retried[0]?.workspacePath, 'attachments/run-2/note.txt')
    assert.equal(
        await readFile(join(group.workspaceDir, retried[0].workspacePath ?? ''), 'utf8'),
        'hello'
    )
})

test('GroupAttachmentService finalizes successful attachments by removing temp files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-finalize-'))
    const { service, repo, group } = createService(root)

    const uploaded = await service.upload('user-1', group, {
        originalname: 'note.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello')
    })
    const tempPath = repo.rows.get(uploaded.id)?.tempPath
    assert.ok(tempPath)
    assert.equal(await readFile(tempPath, 'utf8'), 'hello')

    await service.consumeForRun('user-1', group, [uploaded.id], 'run-1')
    await service.finalizeForRun('user-1', group, 'run-1')

    await assert.rejects(readFile(tempPath, 'utf8'))
})

test('GroupAttachmentService previews consumed image attachments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-preview-'))
    const { service, group } = createService(root)

    const uploaded = await service.upload('user-1', group, {
        originalname: 'photo.png',
        mimetype: 'image/png',
        buffer: Buffer.from([1, 2, 3])
    })
    const [consumed] = await service.consumeForRun('user-1', group, [uploaded.id], 'run-1')

    const preview = await service.preview('user-1', group, uploaded.id)

    assert.equal(preview.attachment.id, uploaded.id)
    assert.equal(preview.attachment.workspacePath, consumed.workspacePath)
    assert.equal(preview.previewKind, 'image')
    assert.equal(preview.mimeType, 'image/png')
    assert.equal(preview.dataUrl, 'data:image/png;base64,AQID')
})

test('GroupAttachmentService rejects preview before attachment is consumed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-preview-unconsumed-'))
    const { service, group } = createService(root)

    const uploaded = await service.upload('user-1', group, {
        originalname: 'photo.png',
        mimetype: 'image/png',
        buffer: Buffer.from([1, 2, 3])
    })

    await assert.rejects(service.preview('user-1', group, uploaded.id), /not been sent/)
})

test('GroupAttachmentService rejects attachments that are already claimed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-claimed-'))
    const { service, group } = createService(root)

    const uploaded = await service.upload('user-1', group, {
        originalname: 'note.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello')
    })

    await service.consumeForRun('user-1', group, [uploaded.id], 'run-1')
    await assert.rejects(
        service.consumeForRun('user-1', group, [uploaded.id], 'run-2'),
        /already been sent/
    )
})

test('GroupAttachmentService mirrors run attachments into a task worktree and cleans them up', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-attachment-mirror-'))
    const { service, group } = createService(root)
    const worktree = join(root, 'worktree')
    await mkdir(worktree, { recursive: true })

    const uploaded = await service.upload('user-1', group, {
        originalname: 'note.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('hello')
    })
    const [consumed] = await service.consumeForRun('user-1', group, [uploaded.id], 'run-1')

    assert.equal(consumed.workspacePath, 'attachments/run-1/note.txt')
    assert.equal(
        await service.mirrorRunAttachmentsToWorktree('user-1', group, 'run-1', worktree),
        1
    )
    assert.equal(await readFile(join(worktree, consumed.workspacePath ?? ''), 'utf8'), 'hello')

    await service.cleanupWorktreeAttachmentMirrors(worktree, 'run-1')
    await assert.rejects(readFile(join(worktree, consumed.workspacePath ?? ''), 'utf8'))
})
