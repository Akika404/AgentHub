import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type {
    DeployManifest,
    DeploymentEvent,
    DeploymentStatus,
    DeploymentView
} from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'
import {
    DEPLOYMENT_RUNNER,
    type DeploymentRunner,
    type RunnerLogLine
} from './deployment-runner.interface.js'

/** Backlog cap per deployment so late subscribers get recent context without unbounded memory. */
const MAX_LOG_BACKLOG = 2000

interface DeploymentRecord {
    view: DeploymentView
    /** ring buffer of recent events for replay to new subscribers. */
    backlog: DeploymentEvent[]
    /** live subscribers' resolvers, woken on each new event. */
    waiters: Array<() => void>
    /** terminal deployments stop accepting new events. */
    closed: boolean
}

/**
 * DeploymentService — lifecycle + log fan-out for service deployments.
 *
 * One active deployment per group (MVP): starting a new one stops the previous.
 * Holds in-memory state only (process-bound, like the runner); a restart drops
 * live deployments, which is acceptable for dev-preview semantics. Logs are
 * streamed over a dedicated SSE channel (see controller) rather than the group
 * run stream, since volume and lifecycle differ.
 */
@Injectable()
export class DeploymentService {
    private readonly logger = new Logger(DeploymentService.name)
    private readonly records = new Map<string, DeploymentRecord>()
    /** groupChatId → active deploymentId (enforces single active per group). */
    private readonly activeByGroup = new Map<string, string>()

    constructor(@Inject(DEPLOYMENT_RUNNER) private readonly runner: DeploymentRunner) {}

    /**
     * Start a service deployment from a deploy card's manifest. Stops any prior
     * active deployment for the group first, creates the deployment record, then
     * lets the runner continue asynchronously. Readiness/failure arrives over
     * the log/status stream so the UI can show install/start progress.
     */
    async start(
        groupId: string,
        repoDir: string,
        manifest: DeployManifest
    ): Promise<DeploymentView> {
        const normalizedManifest = this.normalizeServiceManifest(manifest)
        await this.stopActiveForGroup(groupId)

        const id = randomUUID()
        const now = new Date().toISOString()
        const record: DeploymentRecord = {
            view: {
                id,
                groupChatId: groupId,
                status: 'starting',
                runnerKind: this.runner.kind,
                port: normalizedManifest.port ?? null,
                url: null,
                error: null,
                startedAt: now,
                updatedAt: now
            },
            backlog: [],
            waiters: [],
            closed: false
        }
        this.records.set(id, record)
        this.activeByGroup.set(groupId, id)

        void this.runner
            .start({
                deploymentId: id,
                cwd: repoDir,
                manifest: normalizedManifest,
                onLog: (log) => this.pushLog(id, log),
                onStatus: (status, detail) => this.applyStatus(id, status, detail)
            })
            .catch((err) => {
                const message = err instanceof Error ? err.message : String(err)
                this.logger.warn(`deployment ${id} failed to start: ${message}`)
                this.applyStatus(id, 'failed', { error: message })
            })

        return record.view
    }

    private normalizeServiceManifest(manifest: DeployManifest): DeployManifest {
        if (manifest.mode !== 'service') {
            throw BusinessException.badRequest('Only service deployments can be started')
        }
        const command = manifest.command?.trim()
        const port = manifest.port
        if (!command) {
            throw BusinessException.badRequest('Service deployment requires a start command')
        }
        if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw BusinessException.badRequest('Service deployment requires a valid port')
        }
        const installCommand = manifest.installCommand?.trim()
        const entryPath = manifest.entryPath?.trim()
        const note = manifest.note?.trim()
        return {
            mode: 'service',
            command,
            port,
            ...(installCommand ? { installCommand } : {}),
            ...(entryPath ? { entryPath } : {}),
            ...(note ? { note } : {})
        }
    }

    /** Stop a deployment (idempotent). Validates it belongs to the group. */
    async stop(groupId: string, deploymentId: string): Promise<void> {
        const record = this.records.get(deploymentId)
        if (!record) return
        if (record.view.groupChatId !== groupId) {
            throw BusinessException.notFound(
                `Deployment ${deploymentId} not found in group ${groupId}`
            )
        }
        await this.runner.stop(deploymentId)
        if (this.activeByGroup.get(groupId) === deploymentId) {
            this.activeByGroup.delete(groupId)
        }
        if (record.view.status !== 'stopped' && record.view.status !== 'failed') {
            this.applyStatus(deploymentId, 'stopped', { port: null })
        }
    }

    /** Stop every deployment for a group (called when the group is deleted / closed). */
    async stopAllForGroup(groupId: string): Promise<void> {
        const ids = [...this.records.values()]
            .filter((r) => r.view.groupChatId === groupId && !r.closed)
            .map((r) => r.view.id)
        for (const id of ids) {
            await this.stop(groupId, id).catch((err) =>
                this.logger.warn(`stopAllForGroup ${id}: ${String(err)}`)
            )
        }
    }

    getView(groupId: string, deploymentId: string): DeploymentView {
        const record = this.records.get(deploymentId)
        if (!record || record.view.groupChatId !== groupId) {
            throw BusinessException.notFound(
                `Deployment ${deploymentId} not found in group ${groupId}`
            )
        }
        return record.view
    }

    /**
     * Async-iterable event stream for one deployment: replays the backlog, then
     * tails live events until the deployment reaches a terminal state. Mirrors
     * the consumption shape of the group run stream so the controller maps it to
     * SSE the same way.
     */
    async *subscribe(groupId: string, deploymentId: string): AsyncIterable<DeploymentEvent> {
        const record = this.records.get(deploymentId)
        if (!record || record.view.groupChatId !== groupId) {
            throw BusinessException.notFound(
                `Deployment ${deploymentId} not found in group ${groupId}`
            )
        }
        let cursor = 0
        // Always replay the current status so a fresh subscriber renders immediately.
        yield this.statusEvent(record)
        while (true) {
            while (cursor < record.backlog.length) {
                yield record.backlog[cursor++]
            }
            if (record.closed) return
            await new Promise<void>((resolveWaiter) => record.waiters.push(resolveWaiter))
        }
    }

    private pushLog(deploymentId: string, log: RunnerLogLine): void {
        const record = this.records.get(deploymentId)
        if (!record || record.closed) return
        this.emit(record, {
            type: 'log',
            deploymentId,
            stream: log.stream,
            line: log.line,
            ts: new Date().toISOString()
        })
    }

    private applyStatus(
        deploymentId: string,
        status: DeploymentStatus,
        detail: { port?: number | null; error?: string | null }
    ): void {
        const record = this.records.get(deploymentId)
        if (!record || record.closed) return
        const port = detail.port !== undefined ? detail.port : record.view.port
        record.view = {
            ...record.view,
            status,
            port,
            url: status === 'running' && port ? `http://localhost:${port}` : null,
            error: detail.error ?? (status === 'failed' ? record.view.error : null),
            updatedAt: new Date().toISOString()
        }
        this.emit(record, {
            type: 'status',
            deploymentId,
            status,
            port: record.view.port,
            url: record.view.url,
            error: record.view.error
        })
        if (status === 'stopped' || status === 'failed') {
            if (this.activeByGroup.get(record.view.groupChatId) === deploymentId) {
                this.activeByGroup.delete(record.view.groupChatId)
            }
            this.close(record)
        }
    }
    private emit(record: DeploymentRecord, event: DeploymentEvent): void {
        record.backlog.push(event)
        if (record.backlog.length > MAX_LOG_BACKLOG) {
            record.backlog.splice(0, record.backlog.length - MAX_LOG_BACKLOG)
        }
        this.wake(record)
    }

    private close(record: DeploymentRecord): void {
        record.closed = true
        this.wake(record)
    }

    private wake(record: DeploymentRecord): void {
        const waiters = record.waiters.splice(0)
        for (const resolveWaiter of waiters) resolveWaiter()
    }

    private statusEvent(record: DeploymentRecord): DeploymentEvent {
        return {
            type: 'status',
            deploymentId: record.view.id,
            status: record.view.status,
            port: record.view.port,
            url: record.view.url,
            error: record.view.error
        }
    }

    private async stopActiveForGroup(groupId: string): Promise<void> {
        const activeId = this.activeByGroup.get(groupId)
        if (activeId) await this.stop(groupId, activeId)
    }
}
