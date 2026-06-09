import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { BlackboardService } from './blackboard.service.js'
import type { BlackboardArtifactEntity } from './entities/blackboard-artifact.entity.js'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LEGACY_QUOTED_PATH =
    '"\\346\\226\\207\\346\\241\\243/\\346\\265\\213\\350\\257\\225\\346\\212\\245\\345\\221\\212.md"'
const DECODED_PATH = '文档/测试报告.md'

function emptyRepo(): never {
    return {
        find: async () => [],
        findOne: async () => null,
        create: (value: unknown) => value,
        save: async (value: unknown) => value
    } as never
}

function serviceFor(artifacts: BlackboardArtifactEntity[]): BlackboardService {
    let nextEventId = 1
    const artifactRepo = {
        find: async ({ where }: { where: { groupChatId: string } }) =>
            artifacts.filter((artifact) => artifact.groupChatId === where.groupChatId),
        findOne: async ({ where }: { where: { groupChatId: string; path: string } }) =>
            artifacts.find(
                (artifact) =>
                    artifact.groupChatId === where.groupChatId && artifact.path === where.path
            ) ?? null,
        create: (value: unknown) => value,
        save: async (value: BlackboardArtifactEntity) => value
    }
    const eventRepo = {
        create: (value: Record<string, unknown>) => value,
        save: async (value: Record<string, unknown>) => {
            value.id ??= `event-${nextEventId++}`
            value.createdAt ??= NOW
            return value
        }
    }
    const debug = { log: () => undefined, blackboardSnapshot: (value: unknown) => value }

    return new BlackboardService(
        artifactRepo as never,
        emptyRepo(),
        emptyRepo(),
        emptyRepo(),
        eventRepo as never,
        debug as never
    )
}

test('BlackboardService reads and normalizes legacy git-quoted artifact paths', async () => {
    const artifact = {
        id: 'artifact-1',
        groupChatId: 'group-1',
        type: 'document',
        path: LEGACY_QUOTED_PATH,
        ownerAgentId: 'agent-1',
        version: 2,
        status: 'draft',
        summary: '旧摘要',
        updatedAt: NOW,
        updatedByAgentId: 'agent-1'
    } as BlackboardArtifactEntity
    const service = serviceFor([artifact])

    const found = await service.getArtifact('group-1', DECODED_PATH)
    assert.equal(found?.path, DECODED_PATH)
    assert.equal(artifact.path, LEGACY_QUOTED_PATH)

    const updated = await service.upsertArtifact(
        'group-1',
        {
            path: DECODED_PATH,
            type: 'document',
            summary: '新摘要',
            ownerAgentId: 'agent-1',
            updatedByAgentId: 'agent-2',
            status: 'draft'
        },
        2
    )

    assert.equal(updated.id, 'artifact-1')
    assert.equal(updated.path, DECODED_PATH)
    assert.equal(updated.version, 3)
    assert.equal(artifact.path, DECODED_PATH)
})
