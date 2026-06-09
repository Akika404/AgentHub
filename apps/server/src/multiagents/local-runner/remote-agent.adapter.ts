import { randomUUID } from 'node:crypto'
import type {
    AgentAdapter,
    AgentCapabilities,
    AgentEvent,
    AgentVendor,
    SendOptions
} from '@agenthub/agent-core'
import { getCapabilities } from '@agenthub/agent-core'
import type { LocalRunConfig } from '@agenthub/shared'
import type { LocalRunnerGateway } from './local-runner.gateway.js'

/**
 * RemoteAgentAdapter —— 「本地执行模式」的 AgentAdapter 实现。
 *
 * 不在服务器进程内调用 SDK，而是把一次 send() 通过反向通道（LocalRunnerGateway）转发到
 * 用户桌面端，由本机 Claude Code / Codex 执行，再把回流的统一事件逐条 yield 给上层。
 * 对 AgentRuntimeService.runTurn 完全透明——它只认 AgentEvent 流。
 *
 * 与本机 adapter 的差异：apiKey/baseUrl 不下发（用本机登录态）；agentHomeDirectory 由桌面端
 * 本机解析（不在 LocalRunConfig 内）。
 */
export class RemoteAgentAdapter implements AgentAdapter {
    readonly id: string
    private _sessionId: string | null = null
    private resumeId: string | null = null
    private busy = false

    constructor(
        readonly vendor: AgentVendor,
        private readonly gateway: LocalRunnerGateway,
        private readonly userId: string,
        private readonly config: LocalRunConfig
    ) {
        this.id = config.id ?? `${vendor}-local-${Math.random().toString(36).slice(2, 8)}`
    }

    get sessionId(): string | null {
        return this._sessionId ?? this.resumeId
    }

    resumeWith(sdkSessionId: string): void {
        this.resumeId = sdkSessionId
    }

    capabilities(): AgentCapabilities {
        return getCapabilities(this.vendor)
    }

    async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent> {
        if (this.busy) {
            throw new Error(
                `RemoteAgentAdapter[${this.id}] is busy — wait for the previous send() to finish`
            )
        }
        this.busy = true

        const runId = randomUUID()
        let sawDone = false
        try {
            const stream = this.gateway.runStream(
                this.userId,
                {
                    runId,
                    vendor: this.vendor,
                    prompt,
                    config: this.config,
                    ...(this.resumeId ? { resumeSessionId: this.resumeId } : {}),
                    ...(options?.outputSchema ? { outputSchema: options.outputSchema } : {})
                },
                options?.signal
            )
            for await (const event of stream) {
                if (event.type === 'session_started') this._sessionId = event.sessionId
                if (event.type === 'done') sawDone = true
                yield event
            }
        } catch (err) {
            yield {
                type: 'error',
                vendor: this.vendor,
                message: err instanceof Error ? err.message : String(err),
                fatal: true
            }
        } finally {
            // 流的终态保证：设备掉线 / 异常导致没收到 done 时，补一条让上层收尾。
            if (!sawDone) {
                yield { type: 'done', vendor: this.vendor, success: false }
            }
            this.busy = false
        }
    }
}
