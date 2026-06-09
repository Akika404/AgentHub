import type {
    DeployManifest,
    DeploymentRunnerKind,
    DeploymentStatus
} from '@agenthub/shared'

/** DI token for the active {@link DeploymentRunner}; bind to a concrete runner in the module. */
export const DEPLOYMENT_RUNNER = Symbol('DEPLOYMENT_RUNNER')

/** A line emitted by a running deployment. */
export interface RunnerLogLine {
    stream: 'stdout' | 'stderr' | 'system'
    line: string
}

/** Inputs to start a service deployment. */
export interface RunnerStartInput {
    deploymentId: string
    /** absolute cwd the process runs in (the group's repo dir). */
    cwd: string
    manifest: DeployManifest
    /** push a log line to the deployment's subscribers. */
    onLog: (log: RunnerLogLine) => void
    /** report a lifecycle transition (running once the port answers, or failed). */
    onStatus: (status: DeploymentStatus, detail: { port?: number | null; error?: string | null }) => void
}

export interface RunnerStartResult {
    /** port the iframe targets once running. */
    port: number
}

/**
 * Pluggable backend that actually runs a service deployment. Today the only
 * implementation is {@link LocalProcessRunner} (child_process.spawn); a
 * Docker-backed runner is planned and slots in behind this same interface
 * without touching the card / drawer / service layers.
 *
 * Contract:
 *  - `start` resolves once the process is spawned (not once it's listening);
 *    readiness is reported asynchronously via `onStatus('running', ...)`.
 *  - `stop` is idempotent — stopping an unknown/already-stopped id is a no-op.
 */
export interface DeploymentRunner {
    readonly kind: DeploymentRunnerKind
    start(input: RunnerStartInput): Promise<RunnerStartResult>
    stop(deploymentId: string): Promise<void>
}
