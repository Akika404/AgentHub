/**
 * Deployment contract.
 * Mirrors `apps/server/src/multiagents/group/deployment/dto/*`.
 *
 * After the Orchestrator's final report, a group run may surface a deploy card:
 * a manifest describing how to present the run's deliverable. Two shapes:
 *  - `static`  — a previewable file (html/txt/...); opened in the artifact drawer.
 *  - `service` — a runnable web project; the user confirms, the server starts a
 *                dev server via a {@link DeploymentRunner}, and the renderer shows
 *                the running page in an iframe + streamed logs.
 *
 * Security: the server NEVER auto-starts a service. The card only displays the
 * declared command; the user must explicitly run it. Today the only runner is a
 * local `child_process.spawn`; a Docker-backed runner is planned (hence
 * `runnerKind` on the live deployment view).
 */

export type DeployMode = 'static' | 'service'

/**
 * How to present/run a group run's deliverable. Declared by the Orchestrator's
 * final reviewer (structured output), or inferred (static `index.html`) when no
 * final review ran.
 */
export interface DeployManifest {
  mode: DeployMode
  /**
   * Workspace-relative path to the entry artifact. For `static` this is the file
   * previewed (e.g. `index.html`); for `service` it is optional context.
   */
  entryPath?: string
  /** `service` only: command that starts the dev server, e.g. `npm run dev`. */
  command?: string
  /** `service` only: command run first when dependencies are missing, e.g. `npm install`. */
  installCommand?: string
  /** `service` only: port the dev server listens on; the iframe targets `localhost:<port>`. */
  port?: number
  /** human-facing one-line note shown on the card. */
  note?: string
}

// —— Live deployment lifecycle ——

export type DeploymentStatus =
  | 'installing'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'failed'

/** Which runner backs a live deployment. `docker` is reserved for a future runner. */
export type DeploymentRunnerKind = 'local' | 'docker'

/** A running (or finished) service deployment. */
export interface DeploymentView {
  id: string
  groupChatId: string
  status: DeploymentStatus
  runnerKind: DeploymentRunnerKind
  /** resolved port once running; null until then. */
  port: number | null
  /** url the iframe should load once running; null until then. */
  url: string | null
  /** populated when status === 'failed'. */
  error: string | null
  startedAt: string
  updatedAt: string
}

export type DeploymentLogStream = 'stdout' | 'stderr' | 'system'

/** One log line streamed over the deployment's SSE channel. */
export interface DeploymentLogEvent {
  type: 'log'
  deploymentId: string
  stream: DeploymentLogStream
  line: string
  ts: string
}

/** Lifecycle transition streamed alongside logs on the deployment SSE channel. */
export interface DeploymentStatusEvent {
  type: 'status'
  deploymentId: string
  status: DeploymentStatus
  port: number | null
  url: string | null
  error: string | null
}

export type DeploymentEvent = DeploymentLogEvent | DeploymentStatusEvent

/** Request body for starting a service deployment from a deploy card's manifest. */
export interface StartDeploymentPayload {
  manifest: DeployManifest
}
