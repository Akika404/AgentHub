import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import type { BlackboardTaskNode, BlackboardTaskStatus } from '@agenthub/shared'
import { computeReady, markDownstreamBlocked, hasPendingWork } from '../run/task-scheduler.js'

function node(id: string, deps: string[] = [], status: BlackboardTaskStatus = 'pending'): BlackboardTaskNode {
    return { id, name: id, agentId: `agent-${id}`, deps, status, objective: id }
}

function statusMap(nodes: BlackboardTaskNode[]): Map<string, BlackboardTaskStatus> {
    return new Map(nodes.map((n) => [n.id, n.status]))
}

describe('task-scheduler.computeReady', () => {
    test('no-dependency nodes are ready; dependent nodes wait for deps to be done', () => {
        const nodes = [node('a'), node('b'), node('c', ['a', 'b'])]
        const status = statusMap(nodes)
        const ready = computeReady(nodes, status).map((n) => n.id)
        assert.deepEqual(ready.sort(), ['a', 'b'])
    })

    test('dependent node becomes ready only once all deps are done', () => {
        const nodes = [node('a'), node('b'), node('c', ['a', 'b'])]
        const status = statusMap(nodes)
        status.set('a', 'done')
        assert.deepEqual(
            computeReady(nodes, status).map((n) => n.id),
            ['b'],
            'c still blocked on b'
        )
        status.set('b', 'done')
        assert.deepEqual(
            computeReady(nodes, status).map((n) => n.id),
            ['c'],
            'c ready once a & b done'
        )
    })

    test('doing / done / failed / blocked nodes are never re-picked', () => {
        const nodes = [node('a', [], 'doing'), node('b', [], 'done'), node('c', [], 'failed'), node('d', [], 'blocked')]
        const status = statusMap(nodes)
        assert.deepEqual(computeReady(nodes, status), [])
    })
})

describe('task-scheduler.markDownstreamBlocked', () => {
    test('failing a node blocks its transitive downstream but NOT independent tasks', () => {
        // a -> b -> c ; d is independent
        const nodes = [node('a'), node('b', ['a']), node('c', ['b']), node('d')]
        const status = statusMap(nodes)
        const blocked = markDownstreamBlocked(nodes, 'a', status)
        assert.deepEqual(blocked.sort(), ['b', 'c'], 'b and c are downstream of a')
        assert.equal(status.get('b'), 'blocked')
        assert.equal(status.get('c'), 'blocked')
        assert.equal(status.get('d'), 'pending', 'independent task untouched')
    })

    test('does not touch nodes that already finished', () => {
        const nodes = [node('a'), node('b', ['a'], 'done')]
        const status = statusMap(nodes)
        const blocked = markDownstreamBlocked(nodes, 'a', status)
        assert.deepEqual(blocked, [], 'already-done downstream is not re-blocked')
        assert.equal(status.get('b'), 'done')
    })

    test('diamond: shared downstream blocked once', () => {
        // a,b -> c ; failing a blocks c
        const nodes = [node('a'), node('b'), node('c', ['a', 'b'])]
        const status = statusMap(nodes)
        const blocked = markDownstreamBlocked(nodes, 'a', status)
        assert.deepEqual(blocked, ['c'])
        assert.equal(status.get('c'), 'blocked')
    })
})

describe('task-scheduler.hasPendingWork', () => {
    test('true while any node is pending/ready, false once all terminal', () => {
        const nodes = [node('a', [], 'done'), node('b', [], 'failed')]
        assert.equal(hasPendingWork(nodes, statusMap(nodes)), false)
        const withPending = [node('a', [], 'done'), node('b', [], 'ready')]
        assert.equal(hasPendingWork(withPending, statusMap(withPending)), true)
    })
})
