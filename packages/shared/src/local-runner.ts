/**
 * Reverse-channel protocol — server ↔ desktop local runner.
 *
 * 「本地执行模式」下，服务器把一次 turn 的执行转包给用户桌面端：桌面端用本机已安装的
 * Claude Code / Codex 执行，事件经此通道回流，checkpoint/diff/commit 等文件操作也通过此通道的
 * RPC 在用户本机仓库上执行。
 *
 * 传输层是一条桌面端发起、JWT 鉴权的持久 WebSocket（见 `apps/server` 的 LocalRunnerGateway
 * 与 `apps/desktop` 的 LocalRunnerService）。本文件只定义消息契约，不绑定具体传输实现。
 *
 * 关键约定：
 * - apiKey / baseUrl **不**经此通道下发。local 模式用本机 CLI 自己的登录态（ambient auth）。
 * - `agentHomeDirectory` 由桌面端按本机情况解析（以命中 ambient auth），服务器不指定。
 * - 一次 `run.start` 必然以一条 `done` AgentEvent 收尾（即便失败）；服务器据此释放 turn。
 */

import type { AgentEvent, AgentPermissionMode, AgentReasoningEffort, AgentVendor } from './agent.js'
import type {
  WorkspaceCommitPayload,
  WorkspaceCommitResult,
  WorkspaceDiffSummary
} from './workspace-diff.js'
import type { ArtifactFilePreview } from './blackboard.js'

/** 当前协议版本。握手时桌面端上报，服务器据此判断兼容性。 */
export const LOCAL_RUNNER_PROTOCOL_VERSION = 1

/** 桌面端探测到的本机可用引擎。值为 false 表示该 vendor 的 CLI 未安装/不可用。 */
export interface LocalEngineAvailability {
  claude: boolean
  codex: boolean
}

/**
 * 下发给本机 runner 的运行配置。是 AgentAdapterConfig 的安全子集：
 * 不含 apiKey/baseUrl（用 ambient auth），不含 agentHomeDirectory（桌面端本机解析）。
 */
export interface LocalRunConfig {
  /** 仅日志/调试用 */
  id?: string
  /** 省略时使用本机 CLI 的默认模型配置。 */
  model?: string
  /** 用户本机的工作目录绝对路径 */
  workingDirectory: string
  reasoningEffort?: AgentReasoningEffort
  systemPrompt?: string
  skills?: 'all' | string[]
  mcpServers?: Record<string, unknown>
  allowedTools?: string[]
  permissionMode?: AgentPermissionMode
}

/** RPC 方法名与各自的入参 / 出参映射（checkpoint/diff/commit 代理到本机仓库执行）。 */
export interface LocalRunnerRpcMap {
  'diff.checkpoint': {
    params: { workingDirectory: string; scope: WorkspaceDiffSummary['scope']; ownerId: string }
    result: { ok: true }
  }
  'diff.summarize': {
    params: { workingDirectory: string; scope: WorkspaceDiffSummary['scope']; ownerId: string }
    result: WorkspaceDiffSummary
  }
  'diff.commit': {
    params: {
      workingDirectory: string
      scope: WorkspaceDiffSummary['scope']
      ownerId: string
      payload: WorkspaceCommitPayload
    }
    result: WorkspaceCommitResult
  }
  /** 确认本机工作目录存在且可用（建聊天时调用）。 */
  'dir.ensure': {
    params: { workingDirectory: string }
    result: { ok: true }
  }
  /**
   * 读取本机工作目录内某个产物文件,生成应用内预览负载(仅文件派生字段;blackboard
   * `artifact` 由服务端合成)。路径由服务端从单聊产物快照解析后下发,桌面端仍按工作目录
   * 边界二次校验(相对、无 `..`、在 workdir 内)。
   */
  'artifact.preview': {
    params: { workingDirectory: string; path: string }
    result: ArtifactFilePreview
  }
}

export type LocalRunnerRpcMethod = keyof LocalRunnerRpcMap

// ── 桌面端 → 服务器 ────────────────────────────────────────────────────────

/** 握手：声明设备身份与本机可用引擎。连接建立后桌面端发送的第一条消息。 */
export interface RunnerHelloMessage {
  type: 'hello'
  protocolVersion: number
  /** 稳定的设备标识（桌面端生成并持久化），用于会话设备亲和。 */
  deviceId: string
  /** 人类可读的设备名（如主机名），仅展示用。 */
  deviceName?: string
  engines: LocalEngineAvailability
}

/** 转发一次本机执行产生的统一事件。 */
export interface RunnerRunEventMessage {
  type: 'run.event'
  runId: string
  event: AgentEvent
}

/** RPC 应答（对应服务器下发的 rpc 请求）。 */
export type RunnerRpcResultMessage =
  | { type: 'rpc.result'; requestId: string; ok: true; result: unknown }
  | { type: 'rpc.result'; requestId: string; ok: false; error: string }

/** 心跳应答。 */
export interface RunnerPongMessage {
  type: 'pong'
}

export type RunnerToServerMessage =
  | RunnerHelloMessage
  | RunnerRunEventMessage
  | RunnerRpcResultMessage
  | RunnerPongMessage

// ── 服务器 → 桌面端 ────────────────────────────────────────────────────────

/** 启动一次本机执行。runId 由服务器分配（= turnId）。 */
export interface ServerRunStartMessage {
  type: 'run.start'
  runId: string
  vendor: AgentVendor
  prompt: string
  config: LocalRunConfig
  /** 跨进程恢复用的底层 SDK 会话 id；首轮为空。 */
  resumeSessionId?: string
  /** 单轮结构化输出 JSON Schema。 */
  outputSchema?: Record<string, unknown>
}

/** 请求中止指定 run（客户端断连 / 超时 / 用户主动 abort）。 */
export interface ServerRunAbortMessage {
  type: 'run.abort'
  runId: string
}

/** RPC 请求。requestId 用于和 rpc.result 配对。 */
export interface ServerRpcMessage<M extends LocalRunnerRpcMethod = LocalRunnerRpcMethod> {
  type: 'rpc'
  requestId: string
  method: M
  params: LocalRunnerRpcMap[M]['params']
}

/** 心跳。 */
export interface ServerPingMessage {
  type: 'ping'
}

export type ServerToRunnerMessage =
  | ServerRunStartMessage
  | ServerRunAbortMessage
  | ServerRpcMessage
  | ServerPingMessage
