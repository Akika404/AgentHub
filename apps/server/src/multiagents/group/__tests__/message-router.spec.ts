import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { MessageRouter } from '../routing/message-router.service.js'

const members = [
    { agentId: 'a1', name: '前端' },
    { agentId: 'a2', name: '后端' }
]

describe('MessageRouter', () => {
    const router = new MessageRouter()

    test('single explicit mention → direct_single', () => {
        const r = router.route('改下按钮', ['a1'], members)
        assert.equal(r.routeKind, 'direct_single')
        assert.deepEqual(r.mentionedAgentIds, ['a1'])
    })

    test('two explicit mentions → multi', () => {
        const r = router.route('一起做', ['a1', 'a2'], members)
        assert.equal(r.routeKind, 'multi')
        assert.deepEqual(r.mentionedAgentIds, ['a1', 'a2'])
    })

    test('orchestrator mention → orchestrate', () => {
        const r = router.route('规划一下', ['orchestrator'], members)
        assert.equal(r.routeKind, 'orchestrate')
        assert.equal(r.mentionsOrchestrator, true)
    })

    test('no mention → orchestrate', () => {
        const r = router.route('随便做点啥', undefined, members)
        assert.equal(r.routeKind, 'orchestrate')
        assert.deepEqual(r.mentionedAgentIds, [])
    })

    test('parse @memberName from text → direct_single', () => {
        const r = router.route('@前端 改一下样式', undefined, members)
        assert.equal(r.routeKind, 'direct_single')
        assert.deepEqual(r.mentionedAgentIds, ['a1'])
    })

    test('parse @orchestrator from text → orchestrate', () => {
        const r = router.route('@orchestrator 出个计划', undefined, members)
        assert.equal(r.routeKind, 'orchestrate')
        assert.equal(r.mentionsOrchestrator, true)
    })

    test('unknown mention ignored → orchestrate', () => {
        const r = router.route('做点事', ['ghost'], members)
        assert.equal(r.routeKind, 'orchestrate')
        assert.deepEqual(r.mentionedAgentIds, [])
    })
})
