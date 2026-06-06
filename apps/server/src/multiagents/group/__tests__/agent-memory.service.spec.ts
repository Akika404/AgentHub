import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { AgentMemoryService } from '../memory/agent-memory.service.js'
import { makeDebugLogger, makeRepo } from './test-helpers.js'

describe('AgentMemoryService', () => {
    test('writeCandidate dedups near-identical content within scope', async () => {
        const repo = makeRepo()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mem = new AgentMemoryService(repo as any, makeDebugLogger() as any)
        const first = await mem.writeCandidate('a', 'u', {
            content: 'Use Tailwind tokens',
            type: 'convention',
            scope: { project: 'g' },
            source: { type: 'self_summary' }
        })
        assert.ok(first)
        const dup = await mem.writeCandidate('a', 'u', {
            content: '  use   tailwind TOKENS ',
            type: 'convention',
            scope: { project: 'g' },
            source: { type: 'self_summary' }
        })
        assert.equal(dup, null)
        assert.equal((await mem.retrieve('a', { project: 'g' })).length, 1)
    })

    test('retrieve filters by project scope', async () => {
        const repo = makeRepo()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mem = new AgentMemoryService(repo as any, makeDebugLogger() as any)
        await mem.writeCandidate('a', 'u', {
            content: 'A',
            type: 'lesson',
            scope: { project: 'g1' },
            source: { type: 'self_summary' }
        })
        await mem.writeCandidate('a', 'u', {
            content: 'B',
            type: 'lesson',
            scope: { project: 'g2' },
            source: { type: 'self_summary' }
        })
        assert.equal((await mem.retrieve('a', { project: 'g1' })).length, 1)
        assert.equal((await mem.retrieve('a', { project: 'g2' })).length, 1)
    })
})
