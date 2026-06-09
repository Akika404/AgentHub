import { Injectable, Logger } from '@nestjs/common'
import { ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { DeploymentRunnerKind } from '@agenthub/shared'
import { BusinessException } from '../../../common/index.js'
import type {
    DeploymentRunner,
    RunnerStartInput,
    RunnerStartResult
} from './deployment-runner.interface.js'

/** Probe a freshly-started dev server before declaring it `running`. */
const PROBE_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 500
const INSTALL_TIMEOUT_MS = 5 * 60_000

interface RunningProc {
    child: ChildProcess
    /** set when we intentionally stop it, so the exit handler stays quiet. */
    stopping: boolean
    /** true once the readiness probe has observed this process' port. */
    ready: boolean
}

/**
 * LocalProcessRunner — runs a service deployment as a local child process.
 *
 * Flow: (optional) install deps when `node_modules` is missing → spawn the
 * declared start command in the group's repo dir → poll `localhost:<port>`
 * until it answers → report `running`. Stop kills the whole process group so
 * dev servers that fork children (vite, webpack) don't leak.
 *
 * Isolation is process-level only (no sandbox); the user explicitly confirms
 * the command before this runs. A DockerRunner will provide real isolation
 * behind the same {@link DeploymentRunner} interface.
 */
@Injectable()
export class LocalProcessRunner implements DeploymentRunner {
    readonly kind: DeploymentRunnerKind = 'local'
    private readonly logger = new Logger(LocalProcessRunner.name)
    private readonly procs = new Map<string, RunningProc>()

    async start(input: RunnerStartInput): Promise<RunnerStartResult> {
        const { deploymentId, cwd, manifest, onLog, onStatus } = input
        const port = manifest.port
        const command = manifest.command?.trim()
        if (!command) {
            throw BusinessException.badRequest('Service deployment requires a start command')
        }
        if (!port || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw BusinessException.badRequest('Service deployment requires a valid port')
        }
        await this.assertPortAvailable(port, onLog)

        if (manifest.installCommand && this.needsInstall(cwd)) {
            onStatus('installing', { port })
            onLog({ stream: 'system', line: `$ ${manifest.installCommand}` })
            await this.runToCompletion(deploymentId, manifest.installCommand, cwd, onLog)
        }

        onStatus('starting', { port })
        onLog({ stream: 'system', line: `$ ${command}` })
        const child = this.spawnShell(command, cwd)
        this.procs.set(deploymentId, { child, stopping: false, ready: false })
        this.pipeLogs(child, onLog)

        child.on('error', (err) => {
            const entry = this.procs.get(deploymentId)
            this.procs.delete(deploymentId)
            if (entry?.stopping) {
                onStatus('stopped', { port: null })
                return
            }
            onStatus('failed', { error: err.message })
        })
        child.on('exit', (code, signal) => {
            const entry = this.procs.get(deploymentId)
            this.procs.delete(deploymentId)
            if (entry?.stopping) {
                onStatus('stopped', { port: null })
                return
            }
            const reason = signal ? `signal ${signal}` : `exit code ${code}`
            onStatus('failed', {
                error: entry?.ready
                    ? `Dev server exited (${reason})`
                    : `Dev server exited (${reason}) before becoming ready`
            })
        })

        // readiness probe runs detached; start() resolves once spawned.
        void this.probeUntilReady(deploymentId, port, onLog, onStatus)
        return { port }
    }

    async stop(deploymentId: string): Promise<void> {
        const entry = this.procs.get(deploymentId)
        if (!entry) return
        entry.stopping = true
        this.killTree(entry.child)
        this.procs.delete(deploymentId)
    }

    private needsInstall(cwd: string): boolean {
        // Only meaningful for node projects; harmless (false) elsewhere.
        if (!existsSync(join(cwd, 'package.json'))) return false
        return !existsSync(join(cwd, 'node_modules'))
    }

    private assertPortAvailable(port: number, onLog: RunnerStartInput['onLog']): Promise<void> {
        return new Promise<void>((resolvePromise, reject) => {
            const server = createServer()
            const fail = (): void => {
                server.removeAllListeners()
                const message = `Port ${port} is already in use`
                onLog({ stream: 'system', line: message })
                reject(BusinessException.badRequest(message))
            }
            server.once('error', fail)
            server.once('listening', () => {
                server.close(() => {
                    server.removeAllListeners()
                    resolvePromise()
                })
            })
            server.listen(port, '127.0.0.1')
        })
    }

    private spawnShell(command: string, cwd: string): ChildProcess {
        // Run via the shell so declared commands like `npm run dev` work as-is.
        // detached lets us signal the whole process group on stop.
        return spawn(command, {
            cwd,
            shell: true,
            detached: process.platform !== 'win32',
            env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' }
        })
    }

    private pipeLogs(child: ChildProcess, onLog: RunnerStartInput['onLog']): void {
        const emit = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
            const text = chunk.toString('utf8')
            for (const line of text.split(/\r?\n/)) {
                if (line.length > 0) onLog({ stream, line })
            }
        }
        child.stdout?.on('data', emit('stdout'))
        child.stderr?.on('data', emit('stderr'))
    }

    private async runToCompletion(
        deploymentId: string,
        command: string,
        cwd: string,
        onLog: RunnerStartInput['onLog']
    ): Promise<void> {
        const child = this.spawnShell(command, cwd)
        this.procs.set(deploymentId, { child, stopping: false, ready: false })
        this.pipeLogs(child, onLog)
        try {
            const code = await this.waitForExit(child, INSTALL_TIMEOUT_MS)
            if (code !== 0) {
                throw BusinessException.badRequest(`Install command failed (exit code ${code})`)
            }
        } finally {
            this.procs.delete(deploymentId)
        }
    }

    private waitForExit(child: ChildProcess, timeoutMs: number): Promise<number> {
        return new Promise<number>((resolvePromise, reject) => {
            const timer = setTimeout(() => {
                this.killTree(child)
                reject(BusinessException.badRequest('Install command timed out'))
            }, timeoutMs)
            child.on('exit', (code) => {
                clearTimeout(timer)
                resolvePromise(code ?? 1)
            })
            child.on('error', (err) => {
                clearTimeout(timer)
                reject(err)
            })
        })
    }

    private async probeUntilReady(
        deploymentId: string,
        port: number,
        onLog: RunnerStartInput['onLog'],
        onStatus: RunnerStartInput['onStatus']
    ): Promise<void> {
        const deadline = Date.now() + PROBE_TIMEOUT_MS
        const url = `http://127.0.0.1:${port}/`
        while (Date.now() < deadline) {
            // Stop probing if the process already died or was stopped.
            if (!this.procs.has(deploymentId)) return
            if (await this.isUp(url)) {
                const entry = this.procs.get(deploymentId)
                if (entry) entry.ready = true
                onLog({ stream: 'system', line: `✓ dev server is up on port ${port}` })
                onStatus('running', { port })
                return
            }
            await delay(PROBE_INTERVAL_MS)
        }
        if (this.procs.has(deploymentId)) {
            onStatus('failed', { error: `Dev server did not answer on port ${port} within 60s` })
            await this.stop(deploymentId)
        }
    }

    private async isUp(url: string): Promise<boolean> {
        try {
            const ctrl = new AbortController()
            const timer = setTimeout(() => ctrl.abort(), PROBE_INTERVAL_MS)
            // Any HTTP response (even 404) means the server is listening.
            await fetch(url, { signal: ctrl.signal })
            clearTimeout(timer)
            return true
        } catch {
            return false
        }
    }

    private killTree(child: ChildProcess): void {
        if (child.pid === undefined || child.killed) return
        try {
            if (process.platform === 'win32') {
                spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
            } else {
                // negative pid signals the whole detached process group.
                process.kill(-child.pid, 'SIGTERM')
            }
        } catch (err) {
            this.logger.warn(`Failed to kill process ${child.pid}: ${String(err)}`)
            try {
                child.kill('SIGKILL')
            } catch {
                /* already gone */
            }
        }
    }
}
