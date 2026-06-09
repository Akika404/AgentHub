import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { AsyncQueue } from './async-queue.js'

test('AsyncQueue delivers buffered items in order then ends on close', async () => {
    const q = new AsyncQueue<number>()
    q.push(1)
    q.push(2)
    q.close()

    const got: number[] = []
    for await (const n of q) got.push(n)
    assert.deepEqual(got, [1, 2])
})

test('AsyncQueue resolves a pending pull when an item arrives later', async () => {
    const q = new AsyncQueue<string>()
    const collected: string[] = []
    const consumer = (async () => {
        for await (const s of q) collected.push(s)
    })()

    // 消费者已在等待（队列为空）；稍后推入再关闭。
    await new Promise((r) => setTimeout(r, 5))
    q.push('a')
    q.push('b')
    q.close()
    await consumer
    assert.deepEqual(collected, ['a', 'b'])
})

test('AsyncQueue ignores pushes after close', async () => {
    const q = new AsyncQueue<number>()
    q.close()
    q.push(99)
    const got: number[] = []
    for await (const n of q) got.push(n)
    assert.deepEqual(got, [])
})
