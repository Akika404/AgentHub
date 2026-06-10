import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, ipcMain } from 'electron'
import WebSocket from 'ws'
import {
  createAgent,
  WorkspaceGit,
  buildArtifactPreview,
  writeArtifactEditableContent,
  type AgentAdapterConfig,
  type AgentEvent,
  type AgentVendor
} from '@agenthub/agent-core'
import {
  LOCAL_RUNNER_PROTOCOL_VERSION,
  type LocalEngineAvailability,
  type LocalRunConfig,
  type LocalRunnerRpcMap,
  type RunnerToServerMessage,
  type ServerToRunnerMessage
} from '@agenthub/shared'

const execFileAsync = promisify(execFile)

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30 * 1000
const ENGINE_PROBE_TIMEOUT_MS = 4000

function runnerWsUrl(): string {
  return process.env['AGENTHUB_RUNNER_WS'] ?? 'ws://localhost:3010'
}

/**
 * LocalRunnerService —— 桌面端「本地执行模式」runner（主进程）。
 *
 * 与服务器建一条 JWT 鉴权的持久 WebSocket：收到 run.start 用本机已装的 Claude Code / Codex
 * 在用户本机工作目录执行（apiKey 留空走本机登录态），事件回流；收到 checkpoint/diff/commit
 * RPC 用 WorkspaceGit 在本机仓库执行。断线自动重连。renderer 登录后通过 IPC 启动、登出时停止。
 */
export class LocalRunnerService {
  private socket: WebSocket | null = null
  private token: string | null = null
  private stopped = true
  private reconnectAttempts = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private deviceId: string | null = null
  private engines: LocalEngineAvailability = { claude: false, codex: false }
  /** 进行中的 run：runId -> AbortController。 */
  private readonly runs = new Map<string, AbortController>()
  private readonly git = new WorkspaceGit()

  /** 启动（或用新 token 重启）。renderer 登录/初始化后调用。 */
  async start(token: string): Promise<void> {
    if (this.token === token && this.socket && !this.stopped) return
    this.stop()
    this.token = token
    this.stopped = false
    this.reconnectAttempts = 0
    this.deviceId ??= await this.loadOrCreateDeviceId()
    this.engines = await this.probeEngines()
    this.connect()
  }

  /** 停止：断开连接、取消重连、中止全部在途 run。renderer 登出时调用。 */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const ctrl of this.runs.values()) ctrl.abort()
    this.runs.clear()
    if (this.socket) {
      this.socket.removeAllListeners()
      try {
        this.socket.close()
      } catch {
        /* ignore */
      }
      this.socket = null
    }
  }

  private connect(): void {
    if (this.stopped || !this.token) return
    const socket = new WebSocket(runnerWsUrl(), {
      headers: { Authorization: `Bearer ${this.token}` }
    })
    this.socket = socket

    socket.on('open', () => {
      this.reconnectAttempts = 0
      this.send({
        type: 'hello',
        protocolVersion: LOCAL_RUNNER_PROTOCOL_VERSION,
        deviceId: this.deviceId ?? 'unknown',
        deviceName: this.deviceName(),
        engines: this.engines
      })
    })
    socket.on('message', (raw) => {
      const msg = this.parse(raw)
      if (msg) void this.dispatch(msg)
    })
    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      this.scheduleReconnect()
    })
    socket.on('error', () => {
      // close 会随后触发，重连逻辑在 close 里统一处理。
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped) return
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
    this.reconnectTimer.unref?.()
  }

  private async dispatch(msg: ServerToRunnerMessage): Promise<void> {
    switch (msg.type) {
      case 'ping':
        this.send({ type: 'pong' })
        return
      case 'run.start':
        await this.handleRunStart(msg)
        return
      case 'run.abort':
        this.runs.get(msg.runId)?.abort()
        return
      case 'rpc':
        await this.handleRpc(msg)
        return
    }
  }

  private async handleRunStart(
    msg: Extract<ServerToRunnerMessage, { type: 'run.start' }>
  ): Promise<void> {
    const abort = new AbortController()
    this.runs.set(msg.runId, abort)
    const forward = (event: AgentEvent): void =>
      this.send({ type: 'run.event', runId: msg.runId, event })

    try {
      const adapter = createAgent(msg.vendor, this.toAdapterConfig(msg.vendor, msg.config))
      if (msg.resumeSessionId) adapter.resumeWith(msg.resumeSessionId)
      for await (const event of adapter.send(msg.prompt, {
        signal: abort.signal,
        ...(msg.outputSchema ? { outputSchema: msg.outputSchema } : {})
      })) {
        forward(event)
      }
    } catch (err) {
      // 兜底：adapter 内部已保证发 done，但若 createAgent 抛出则在此补齐错误 + 终态。
      forward({
        type: 'error',
        vendor: msg.vendor,
        message: err instanceof Error ? err.message : String(err),
        fatal: true
      })
      forward({ type: 'done', vendor: msg.vendor, success: false })
    } finally {
      this.runs.delete(msg.runId)
    }
  }

  /**
   * LocalRunConfig -> AgentAdapterConfig。
   *
   * apiKey 留空：本机 CLI 走自己的登录态（ambient auth）。agentHomeDirectory 按 vendor 解析到
   * 本机默认配置目录，使 CLAUDE_CONFIG_DIR / CODEX_HOME 命中用户已登录的 ~/.claude、~/.codex。
   */
  private toAdapterConfig(vendor: AgentVendor, config: LocalRunConfig): AgentAdapterConfig {
    // claude adapter 用 join(agentHomeDirectory, '.claude') 作 CLAUDE_CONFIG_DIR -> 传 homedir()
    // codex adapter 用 agentHomeDirectory 作 CODEX_HOME -> 传 ~/.codex
    const agentHomeDirectory = vendor === 'claude' ? homedir() : join(homedir(), '.codex')
    return {
      id: config.id,
      ...(config.model ? { model: config.model } : {}),
      agentHomeDirectory,
      workingDirectory: config.workingDirectory,
      apiKey: '',
      reasoningEffort: config.reasoningEffort,
      systemPrompt: config.systemPrompt,
      skills: config.skills,
      mcpServers: config.mcpServers,
      allowedTools: config.allowedTools,
      permissionMode: config.permissionMode
    }
  }

  private async handleRpc(msg: Extract<ServerToRunnerMessage, { type: 'rpc' }>): Promise<void> {
    try {
      const result = await this.runRpc(msg)
      this.send({ type: 'rpc.result', requestId: msg.requestId, ok: true, result })
    } catch (err) {
      this.send({
        type: 'rpc.result',
        requestId: msg.requestId,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async runRpc(msg: Extract<ServerToRunnerMessage, { type: 'rpc' }>): Promise<unknown> {
    // method 与 params 在 ServerRpcMessage 上不是关联判别联合，switch 无法窄化 params，
    // 故在各分支按 method 显式取对应入参形状。
    switch (msg.method) {
      case 'diff.checkpoint': {
        const p = msg.params as LocalRunnerRpcMap['diff.checkpoint']['params']
        await this.git.markCheckpoint(p.workingDirectory, p.scope, p.ownerId)
        return { ok: true }
      }
      case 'diff.summarize': {
        const p = msg.params as LocalRunnerRpcMap['diff.summarize']['params']
        return this.git.summarize(p.workingDirectory, p.scope, p.ownerId)
      }
      case 'diff.commit': {
        const p = msg.params as LocalRunnerRpcMap['diff.commit']['params']
        return this.git.commit(p.workingDirectory, p.scope, p.ownerId, p.payload)
      }
      case 'dir.ensure': {
        const p = msg.params as LocalRunnerRpcMap['dir.ensure']['params']
        await mkdir(p.workingDirectory, { recursive: true })
        return { ok: true }
      }
      case 'artifact.preview': {
        const p = msg.params as LocalRunnerRpcMap['artifact.preview']['params']
        return buildArtifactPreview(p.workingDirectory, p.path)
      }
      case 'artifact.write': {
        const p = msg.params as LocalRunnerRpcMap['artifact.write']['params']
        return writeArtifactEditableContent(p.workingDirectory, p.path, p.content)
      }
    }
  }

  private send(msg: RunnerToServerMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg))
    }
  }

  private parse(raw: unknown): ServerToRunnerMessage | null {
    try {
      const text = typeof raw === 'string' ? raw : String(raw)
      return JSON.parse(text) as ServerToRunnerMessage
    } catch {
      return null
    }
  }

  private deviceName(): string {
    try {
      return hostname()
    } catch {
      return 'desktop'
    }
  }

  private async loadOrCreateDeviceId(): Promise<string> {
    const file = join(app.getPath('userData'), 'runner-device-id')
    try {
      const existing = (await readFile(file, 'utf8')).trim()
      if (existing) return existing
    } catch {
      /* not created yet */
    }
    const id = randomUUID()
    await writeFile(file, id, 'utf8').catch(() => undefined)
    return id
  }

  /** 探测本机是否装了 claude / codex CLI（`--version` 退出 0 即视为可用）。 */
  private async probeEngines(): Promise<LocalEngineAvailability> {
    const [claude, codex] = await Promise.all([this.probe('claude'), this.probe('codex')])
    return { claude, codex }
  }

  private async probe(bin: string): Promise<boolean> {
    try {
      await execFileAsync(bin, ['--version'], { timeout: ENGINE_PROBE_TIMEOUT_MS })
      return true
    } catch {
      return false
    }
  }
}

/**
 * 注册本地 runner 的 IPC 通道（单例）。
 * - `runner:start`（token）：登录后启动/重启反向通道。
 * - `runner:stop`：登出时停止。
 */
export function registerLocalRunner(): void {
  const service = new LocalRunnerService()
  ipcMain.handle('runner:start', async (_event, token: string) => {
    if (typeof token === 'string' && token) await service.start(token)
  })
  ipcMain.handle('runner:stop', () => {
    service.stop()
  })
  app.on('before-quit', () => service.stop())
}
