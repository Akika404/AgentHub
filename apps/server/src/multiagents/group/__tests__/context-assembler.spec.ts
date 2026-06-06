import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ContextAssembler } from '../context/context-assembler.service.js'

function makeBlackboard() {
    return {
        getState: async () => ({
            artifacts: [
                {
                    id: 'art1',
                    type: 'code',
                    path: 'src/a.ts',
                    ownerAgentId: 'a1',
                    version: 2,
                    status: 'draft',
                    summary: 'A summary',
                    updatedAt: '',
                    updatedByAgentId: 'a1'
                },
                {
                    id: 'art2',
                    type: 'code',
                    path: 'src/b.ts',
                    ownerAgentId: 'a2',
                    version: 1,
                    status: 'draft',
                    summary: 'B summary',
                    updatedAt: '',
                    updatedByAgentId: 'a2'
                }
            ],
            decisions: [
                { id: 'd1', content: 'use local time', status: 'superseded' },
                { id: 'd2', content: 'use UTC', status: 'approved' }
            ],
            contracts: [
                {
                    id: 'time_api',
                    spec: {},
                    ownerAgentId: 'a1',
                    consumers: [],
                    approvalRequired: true,
                    version: 1
                }
            ],
            taskGraph: []
        }),
        summarize: async () => 'SUMMARY'
    }
}

function makeMemory(staleCalls: string[]) {
    return {
        retrieve: async () => [
            {
                id: 'm1',
                agentId: 'a1',
                content: 'keep me',
                type: 'lesson',
                scope: { project: 'g', module: null },
                source: { type: 'self_summary', ref: null },
                status: 'active',
                createdAt: '',
                lastUsedAt: null
            },
            {
                id: 'm2',
                agentId: 'a1',
                content: 'stale me',
                type: 'convention',
                scope: { project: 'g', module: null },
                source: { type: 'blackboard', ref: 'd1' }, // d1 is superseded → conflict
                status: 'active',
                createdAt: '',
                lastUsedAt: null
            }
        ],
        markStale: async (id: string) => {
            staleCalls.push(id)
        }
    }
}

const baseInput = {
    groupId: 'g',
    agentId: 'a1',
    task: { objective: 'do the thing', mode: 'modify_existing' as const },
    scope: { project: 'g', module: null },
    targetArtifacts: ['src/a.ts']
}

describe('ContextAssembler', () => {
    test('drops memory that conflicts with a superseded blackboard decision', async () => {
        const stale: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ca = new ContextAssembler(makeBlackboard() as any, makeMemory(stale) as any)
        const out = await ca.assemble(baseInput)
        assert.ok(out.trace.droppedMemoryIds.includes('m2'))
        assert.ok(stale.includes('m2'))
        assert.ok(out.trace.memoryIds.includes('m1'))
    })

    test('budget trim drops memory before target artifacts / contracts', async () => {
        const stale: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ca = new ContextAssembler(makeBlackboard() as any, makeMemory(stale) as any)
        const out = await ca.assemble({ ...baseInput, budget: { maxChars: 60 } })
        assert.ok(out.trace.omitted.includes('memory'))
        // target artifact + contracts are guaranteed sections
        assert.ok(out.prompt.includes('src/a.ts'))
        assert.ok(out.prompt.includes('time_api'))
    })

    test('case A hot context is attached when provided', async () => {
        const stale: string[] = []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ca = new ContextAssembler(makeBlackboard() as any, makeMemory(stale) as any)
        const out = await ca.assemble({
            ...baseInput,
            hotContext: { recentUserIntents: ['上次的需求'] }
        })
        assert.ok(out.prompt.includes('Recent hot context'))
    })
})
