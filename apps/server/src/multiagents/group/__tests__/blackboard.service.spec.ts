import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { makeDebugLogger, makeRepo } from './test-helpers.js'

function makeService() {
    const artifact = makeRepo()
    const decision = makeRepo()
    const contract = makeRepo()
    const task = makeRepo()
    const event = makeRepo()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bb = new BlackboardService(
        artifact as any,
        decision as any,
        contract as any,
        task as any,
        event as any,
        makeDebugLogger() as any
    )
    return { bb, event }
}

const ARTIFACT = {
    path: 'src/a.ts',
    type: 'code' as const,
    summary: 's',
    ownerAgentId: 'a1',
    updatedByAgentId: 'a1'
}

describe('BlackboardService — optimistic lock', () => {
    test('rejects write with stale based_on_version', async () => {
        const { bb } = makeService()
        const v1 = await bb.upsertArtifact('g', ARTIFACT)
        assert.equal(v1.version, 1)
        const v2 = await bb.upsertArtifact('g', ARTIFACT, 1)
        assert.equal(v2.version, 2)
        await assert.rejects(() => bb.upsertArtifact('g', ARTIFACT, 1), /BLACKBOARD_CONFLICT/)
    })
})

describe('BlackboardService — decision supersede', () => {
    test('writing a decision supersedes referenced old ones', async () => {
        const { bb } = makeService()
        const d1 = await bb.writeDecision('g', {
            content: 'use local time',
            createdByAgentId: 'a1'
        })
        await bb.writeDecision('g', {
            content: 'use UTC',
            createdByAgentId: 'a1',
            supersedes: [d1.id]
        })
        const state = await bb.getState('g')
        const old = state.decisions.find((d) => d.id === d1.id)
        assert.equal(old?.status, 'superseded')
    })
})

describe('BlackboardService — contract owner protection', () => {
    test('non-owner cannot modify an approvalRequired contract', async () => {
        const { bb } = makeService()
        await bb.writeContract(
            'g',
            { contractKey: 'time_api', spec: {}, ownerAgentId: 'a1', approvalRequired: true },
            'a1'
        )
        await assert.rejects(
            () =>
                bb.writeContract(
                    'g',
                    { contractKey: 'time_api', spec: { x: 1 }, ownerAgentId: 'a2' },
                    'a2'
                ),
            /CONTRACT_APPROVAL_REQUIRED/
        )
        const owned = await bb.writeContract(
            'g',
            { contractKey: 'time_api', spec: { y: 2 }, ownerAgentId: 'a1' },
            'a1'
        )
        assert.equal(owned.version, 2)
    })

    test('canWriteContract reflects owner protection', async () => {
        const { bb } = makeService()
        await bb.writeContract(
            'g',
            { contractKey: 'time_api', spec: {}, ownerAgentId: 'a1', approvalRequired: true },
            'a1'
        )
        assert.equal((await bb.canWriteContract('g', 'time_api', 'a2')).allowed, false)
        assert.equal((await bb.canWriteContract('g', 'time_api', 'a1')).allowed, true)
        assert.equal((await bb.canWriteContract('g', 'new_api', 'a2')).allowed, true)
    })
})
