import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentEvent, LocalRunConfig } from '@agenthub/shared'
import { RemoteAgentAdapter } from './remote-agent.adapter.js'
import type { LocalRunnerGateway } from './local-runner.gateway.js'

const CONFIG: LocalRunConfig = { model: 'claude-x', workingDirectory: '/tmp/work' }

/** 用一个最小假 gateway 驱动 adapter，校验事件透传 / sessionId 捕获 / done 兜底。 */
function fakeGateway(script: AgentEvent[] | (() => never)): LocalRunnerGateway {
    return {
        runStream: async function* () {
            if (typeof script === 'function') script()
            else for (const ev of script) yield ev
        }
    } as unknown as LocalRunnerGateway
}

async function collect(adapter: RemoteAgentAdapter, prompt = 'hi'): Promise<AgentEvent[]> {
    const out: AgentEvent[] = []
    for await (const ev of adapter.send(prompt)) out.push(ev)
    return out
}

test('RemoteAgentAdapter forwards events and captures sessionId', async () => {
    const gateway = fakeGateway([
        { type: 'session_started', vendor: 'claude', sessionId: 'sess-1' },
        { type: 'text', vendor: 'claude', text: 'hello' },
        { type: 'done', vendor: 'claude', success: true, finalText: 'hello' }
    ])
    const adapter = new RemoteAgentAdapter('claude', gateway, 'user-1', CONFIG)
    const events = await collect(adapter)

    assert.equal(adapter.sessionId, 'sess-1')
    assert.deepEqual(
        events.map((e) => e.type),
        ['session_started', 'text', 'done']
    )
})

test('RemoteAgentAdapter synthesizes a failing done when stream ends without one', async () => {
    const gateway = fakeGateway([{ type: 'text', vendor: 'codex', text: 'partial' }])
    const adapter = new RemoteAgentAdapter('codex', gateway, 'user-1', CONFIG)
    const events = await collect(adapter)

    const done = events.at(-1)
    assert.equal(done?.type, 'done')
    assert.equal(done?.type === 'done' && done.success, false)
})

test('RemoteAgentAdapter turns a gateway throw into fatal error + done', async () => {
    const gateway = fakeGateway(() => {
        throw new Error('本地 runner 未连接')
    })
    const adapter = new RemoteAgentAdapter('claude', gateway, 'user-1', CONFIG)
    const events = await collect(adapter)

    assert.equal(events[0]?.type, 'error')
    assert.equal(events[0]?.type === 'error' && events[0].fatal, true)
    assert.equal(events.at(-1)?.type, 'done')
})

test('RemoteAgentAdapter rejects concurrent send()', async () => {
    const gateway = fakeGateway([{ type: 'done', vendor: 'claude', success: true }])
    const adapter = new RemoteAgentAdapter('claude', gateway, 'user-1', CONFIG)
    const first = adapter.send('a')[Symbol.asyncIterator]()
    await first.next() // 启动并占用 busy

    // send() 是 async generator，busy 守卫在首次 next() 时触发（非调用时）。
    const second = adapter.send('b')[Symbol.asyncIterator]()
    await assert.rejects(() => second.next(), /busy/)

    // 排空第一个流，释放 busy
    while (!(await first.next()).done) {
        /* drain */
    }
})
