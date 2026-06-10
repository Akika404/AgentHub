import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type {
    AgentEvent,
    LocalEngineAvailability,
    LocalRunnerRpcMap,
    LocalRunnerRpcMethod,
    RunnerToServerMessage,
    ServerToRunnerMessage
} from '@agenthub/shared'
import { LOCAL_RUNNER_PROTOCOL_VERSION } from '@agenthub/shared'
import { TokenService } from '../../user/auth/token.service.js'
import { AsyncQueue } from './async-queue.js'

/** 一个已连接的桌面端设备。 */
interface RunnerConnection {
    socket: WebSocket
    userId: string
    deviceId: string
    deviceName?: string
    engines: LocalEngineAvailability
    /** 该连接上进行中的 run：runId -> 事件队列。 */
    runs: Map<string, AsyncQueue<AgentEvent>>
    /** 该连接上等待应答的 RPC：requestId -> resolver。 */
    pendingRpc: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
}

const RPC_TIMEOUT_MS = 30 * 1000

/**
 * LocalRunnerGateway —— 服务器侧反向通道。
 *
 * 桌面端「本地执行模式」的 runner 用一条 JWT 鉴权的 WebSocket 连上来；服务器据此把一次
 * turn 的执行（run.start）与 checkpoint/diff/commit（rpc）转发到用户本机，事件/结果回流后交给上层。
 *
 * v1：每个用户最多保留一条活跃连接（后连的设备顶替先连的）。RemoteAgentAdapter 与
 * AgentChatService 通过本网关的 isConnected / runStream / abortRun / rpc 与设备交互。
 */
@Injectable()
export class LocalRunnerGateway implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(LocalRunnerGateway.name)
    private server: WebSocketServer | null = null
    /** userId -> 当前连接。 */
    private readonly connections = new Map<string, RunnerConnection>()

    constructor(
        private readonly tokens: TokenService,
        private readonly config: ConfigService
    ) {}

    onModuleInit(): void {
        const port = this.config.get<number>('LOCAL_RUNNER_WS_PORT', 3010)
        this.server = new WebSocketServer({ port })
        this.server.on('connection', (socket, req) => {
            void this.onConnection(socket, req)
        })
        this.server.on('error', (err) => this.logger.error(`WS server error: ${this.errMsg(err)}`))
        this.logger.log(`Local runner WS gateway listening on ws://localhost:${port}`)
    }

    onModuleDestroy(): void {
        for (const conn of this.connections.values()) conn.socket.close()
        this.connections.clear()
        this.server?.close()
    }

    /** 该用户当前是否有可用的本机 runner（且声明支持该 vendor 引擎）。 */
    isConnected(userId: string, engine?: keyof LocalEngineAvailability): boolean {
        const conn = this.connections.get(userId)
        if (!conn) return false
        return engine ? conn.engines[engine] === true : true
    }

    /** 该用户当前连接的设备 id（无连接为 null）。 */
    deviceId(userId: string): string | null {
        return this.connections.get(userId)?.deviceId ?? null
    }

    private async onConnection(socket: WebSocket, req: IncomingMessage): Promise<void> {
        const userId = await this.authenticate(req)
        if (!userId) {
            socket.close(4401, 'unauthorized')
            return
        }

        socket.once('message', (raw) => {
            const msg = this.parse(raw)
            if (!msg || msg.type !== 'hello') {
                socket.close(4400, 'expected hello')
                return
            }
            if (msg.protocolVersion !== LOCAL_RUNNER_PROTOCOL_VERSION) {
                socket.close(4426, 'protocol version mismatch')
                return
            }
            this.register(socket, userId, msg.deviceId, msg.deviceName, msg.engines)
        })
    }

    private register(
        socket: WebSocket,
        userId: string,
        deviceId: string,
        deviceName: string | undefined,
        engines: LocalEngineAvailability
    ): void {
        // 顶替既有连接：关闭旧 socket、清掉它的在途 run/rpc。
        const existing = this.connections.get(userId)
        if (existing && existing.socket !== socket) {
            this.teardown(existing, 'replaced by a newer device connection')
            existing.socket.close(4409, 'replaced')
        }

        const conn: RunnerConnection = {
            socket,
            userId,
            deviceId,
            deviceName,
            engines,
            runs: new Map(),
            pendingRpc: new Map()
        }
        this.connections.set(userId, conn)
        this.logger.log(
            `Runner connected: user=${userId} device=${deviceId} engines=${JSON.stringify(engines)}`
        )

        socket.on('message', (raw) => {
            const msg = this.parse(raw)
            if (msg) this.dispatch(conn, msg)
        })
        socket.on('close', () => {
            if (this.connections.get(userId) === conn) this.connections.delete(userId)
            this.teardown(conn, 'device disconnected')
        })
        socket.on('error', (err) =>
            this.logger.warn(`Runner socket error (user=${userId}): ${this.errMsg(err)}`)
        )
    }

    /** 处理对端推来的消息。 */
    private dispatch(conn: RunnerConnection, msg: RunnerToServerMessage): void {
        switch (msg.type) {
            case 'hello':
                // 重复 hello（同 socket 重声明引擎）：更新能力。
                conn.engines = msg.engines
                return
            case 'run.event': {
                const queue = conn.runs.get(msg.runId)
                if (!queue) return
                queue.push(msg.event)
                // done 是流的终态：入队后关闭，让消费侧 for-await 自然结束。
                if (msg.event.type === 'done') {
                    queue.close()
                    conn.runs.delete(msg.runId)
                }
                return
            }
            case 'rpc.result': {
                const pending = conn.pendingRpc.get(msg.requestId)
                if (!pending) return
                conn.pendingRpc.delete(msg.requestId)
                if (msg.ok) pending.resolve(msg.result)
                else pending.reject(new Error(msg.error))
                return
            }
            case 'pong':
                return
        }
    }

    /**
     * 启动一次本机执行，返回该 run 的统一事件流。
     *
     * 调用方（RemoteAgentAdapter.send）逐条消费直到 `done`。signal 触发时向设备发 run.abort。
     * 设备未连接 / vendor 引擎不可用时抛错（上层转成 done(success=false)）。
     */
    async *runStream(
        userId: string,
        start: Omit<Extract<ServerToRunnerMessage, { type: 'run.start' }>, 'type'>,
        signal?: AbortSignal
    ): AsyncIterable<AgentEvent> {
        const conn = this.connections.get(userId)
        if (!conn) throw new Error('本地 runner 未连接')
        if (!conn.engines[start.vendor]) {
            throw new Error(`本地 runner 未提供 ${start.vendor} 引擎`)
        }

        const queue = new AsyncQueue<AgentEvent>()
        conn.runs.set(start.runId, queue)

        const onAbort = (): void => this.send(conn, { type: 'run.abort', runId: start.runId })
        if (signal) {
            if (signal.aborted) onAbort()
            else signal.addEventListener('abort', onAbort, { once: true })
        }

        this.send(conn, { type: 'run.start', ...start })
        try {
            yield* queue
        } finally {
            signal?.removeEventListener('abort', onAbort)
            conn.runs.delete(start.runId)
        }
    }

    /** 主动请求中止某 run（超时 / 用户 abort，独立于 send 的 signal）。 */
    abortRun(userId: string, runId: string): void {
        const conn = this.connections.get(userId)
        if (conn) this.send(conn, { type: 'run.abort', runId })
    }

    /** 发起一次 RPC（checkpoint/diff/commit/dir.ensure），等待对端应答。 */
    async rpc<M extends LocalRunnerRpcMethod>(
        userId: string,
        method: M,
        params: LocalRunnerRpcMap[M]['params']
    ): Promise<LocalRunnerRpcMap[M]['result']> {
        const conn = this.connections.get(userId)
        if (!conn) throw new Error('本地 runner 未连接')

        const requestId = randomUUID()
        return new Promise<LocalRunnerRpcMap[M]['result']>((resolve, reject) => {
            const timer = setTimeout(() => {
                conn.pendingRpc.delete(requestId)
                reject(new Error(`Local runner RPC "${method}" timed out`))
            }, RPC_TIMEOUT_MS)
            timer.unref?.()

            conn.pendingRpc.set(requestId, {
                resolve: (v) => {
                    clearTimeout(timer)
                    resolve(v as LocalRunnerRpcMap[M]['result'])
                },
                reject: (e) => {
                    clearTimeout(timer)
                    reject(e)
                }
            })
            this.send(conn, { type: 'rpc', requestId, method, params })
        })
    }

    private async authenticate(req: IncomingMessage): Promise<string | null> {
        const token = this.extractToken(req)
        if (!token) return null
        try {
            const payload = await this.tokens.verify(token)
            if (await this.tokens.isRevoked(payload.jti)) return null
            return payload.sub
        } catch {
            return null
        }
    }

    private extractToken(req: IncomingMessage): string | null {
        const header = req.headers['authorization']
        if (typeof header === 'string') {
            const [scheme, value] = header.split(' ')
            if (scheme === 'Bearer' && value) return value
        }
        // 回退：从 query 取（部分 ws 客户端不便设置 header）
        try {
            const url = new URL(req.url ?? '', 'http://localhost')
            return url.searchParams.get('token')
        } catch {
            return null
        }
    }

    private parse(raw: unknown): RunnerToServerMessage | null {
        try {
            const text = typeof raw === 'string' ? raw : String(raw)
            return JSON.parse(text) as RunnerToServerMessage
        } catch {
            return null
        }
    }

    private send(conn: RunnerConnection, msg: ServerToRunnerMessage): void {
        try {
            conn.socket.send(JSON.stringify(msg))
        } catch (err) {
            this.logger.warn(`Failed to send to runner (user=${conn.userId}): ${this.errMsg(err)}`)
        }
    }

    private teardown(conn: RunnerConnection, reason: string): void {
        for (const queue of conn.runs.values()) queue.close()
        conn.runs.clear()
        for (const pending of conn.pendingRpc.values()) {
            pending.reject(new Error(`Local runner unavailable: ${reason}`))
        }
        conn.pendingRpc.clear()
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
