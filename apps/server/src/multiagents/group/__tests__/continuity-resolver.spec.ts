import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ContinuityResolver } from '../routing/continuity-resolver.service.js'
import { makeDebugLogger, makeFakeRedis } from './test-helpers.js'

function makeResolver(artifacts: Array<{ path: string }>) {
    const redis = makeFakeRedis()
    const blackboard = {
        getState: async () => ({ artifacts, decisions: [], contracts: [], taskGraph: [] })
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cr = new ContinuityResolver(redis as any, blackboard as any, makeDebugLogger() as any)
    return cr
}

describe('ContinuityResolver', () => {
    test('hasStrongDeixis detects strong deixis words', () => {
        const cr = makeResolver([])
        assert.equal(cr.hasStrongDeixis('那个按钮再改改'), true)
        assert.equal(cr.hasStrongDeixis('做个全新的登录页'), false)
    })

    test('case A: hot buffer + strong deixis', async () => {
        const cr = makeResolver([{ path: 'src/Button.tsx' }])
        await cr.writeBuffer('g', 'a1', {
            recentUserIntents: ['做按钮'],
            recentAgentOutputs: ['done'],
            recentArtifacts: [{ path: 'src/Button.tsx', version: 1 }],
            mentionIndex: {}
        })
        const r = await cr.resolve('g', 'a1', '刚才那个按钮再改改')
        assert.equal(r.case, 'A')
        assert.deepEqual(r.targetArtifactPaths, ['src/Button.tsx'])
        assert.ok(r.hotContext)
    })

    test('case B: blackboard artifact match without hot buffer', async () => {
        const cr = makeResolver([{ path: 'src/Button.tsx' }])
        const r = await cr.resolve('g', 'a2', '更新 Button.tsx 的样式')
        assert.equal(r.case, 'B')
        assert.deepEqual(r.targetArtifactPaths, ['src/Button.tsx'])
    })

    test('case C: no buffer and no artifact match', async () => {
        const cr = makeResolver([{ path: 'src/Button.tsx' }])
        const r = await cr.resolve('g', 'a3', '做一个全新的支付页面')
        assert.equal(r.case, 'C')
        assert.deepEqual(r.targetArtifactPaths, [])
        assert.equal(r.needsOrchestratorJudgement, false)
    })

    test('ambiguous: strong deixis without resolvable target needs Orchestrator', async () => {
        const cr = makeResolver([{ path: 'src/Button.tsx' }])
        const r = await cr.resolve('g', 'a4', '刚才那个再改改')
        assert.equal(r.case, 'C')
        assert.deepEqual(r.targetArtifactPaths, [])
        assert.equal(r.needsOrchestratorJudgement, true)
    })

    test('ambiguous: multiple artifact matches need Orchestrator', async () => {
        const cr = makeResolver([{ path: 'src/Button.tsx' }, { path: 'src/Button.spec.tsx' }])
        const r = await cr.resolve('g', 'a5', '更新 Button 的实现')
        assert.equal(r.case, 'B')
        assert.deepEqual(r.targetArtifactPaths, ['src/Button.tsx', 'src/Button.spec.tsx'])
        assert.equal(r.needsOrchestratorJudgement, true)
    })
})
