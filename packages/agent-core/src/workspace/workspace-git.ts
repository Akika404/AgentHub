import { execFile } from 'node:child_process'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import type {
  WorkspaceCommitPayload,
  WorkspaceCommitResult,
  WorkspaceDiffFile,
  WorkspaceDiffFileStatus,
  WorkspaceDiffSummary
} from '@agenthub/shared'
import { NOOP_LOGGER, type CoreLogger } from '../logger.js'

const execFileAsync = promisify(execFile)

const MAX_DIFF_BYTES = 80 * 1024
const MAX_DIFF_LINES = 400
const MAX_FILE_INSPECT_BYTES = 1024 * 1024
const DEFAULT_COMMIT_MESSAGE = 'chore: save workspace changes'
const GIT_MAX_BUFFER = 512 * 1024

const IGNORED_PATH_PREFIXES = ['.agenthub/', '.codex/', '.claude/', '.agents/']
const IGNORED_EXACT_PATHS = new Set(['ACTIVE'])
const VISIBLE_PATHSPECS = [
  '.',
  ':(exclude).agenthub/**',
  ':(exclude).codex/**',
  ':(exclude).claude/**',
  ':(exclude).agents/**',
  ':(exclude)ACTIVE'
]

interface StatusEntry {
  path: string
  oldPath: string | null
  xy: string
  status: WorkspaceDiffFileStatus
}

type DiffBase = string | null

interface LineStats {
  additions: number
  deletions: number
  binary: boolean
  tooLargeHint: boolean
}

/**
 * 框架无关的 workspace git 引擎。
 *
 * 原 `WorkspaceDiffService` 的 git 逻辑抽到这里，使其既能在服务器（被薄 Nest
 * wrapper 包裹）跑，也能在桌面端的本地 runner 直接跑——本地执行模式下，diff/commit
 * 通过反向通道转发到用户机器，由这里在用户本机仓库上执行。
 *
 * 与原服务的差异：抛普通 `Error`（不再是 `BusinessException`），日志走注入的
 * `CoreLogger`（默认静默）。服务器 wrapper 负责把 `Error` 映射回 `BusinessException`。
 */
export class WorkspaceGit {
  private readonly logger: CoreLogger

  constructor(logger: CoreLogger = NOOP_LOGGER) {
    this.logger = logger
  }

  async markCheckpoint(
    workingDirectory: string,
    scope: WorkspaceDiffSummary['scope'],
    ownerId: string
  ): Promise<void> {
    await this.ensureGitRepository(workingDirectory)
    await this.updateCheckpoint(workingDirectory, scope, ownerId)
  }

  async summarize(
    workingDirectory: string,
    scope: WorkspaceDiffSummary['scope'],
    ownerId: string
  ): Promise<WorkspaceDiffSummary> {
    await this.ensureGitRepository(workingDirectory)
    const headRef = await this.currentHead(workingDirectory)
    const baseRef = await this.currentCheckpoint(workingDirectory, scope, ownerId)
    const entries = await this.diffEntries(workingDirectory, baseRef)
    const files: WorkspaceDiffFile[] = []

    for (const entry of entries) {
      if (this.isIgnoredPath(entry.path) && (!entry.oldPath || this.isIgnoredPath(entry.oldPath))) {
        continue
      }
      files.push(await this.fileSummary(workingDirectory, entry, baseRef))
    }

    files.sort((a, b) => a.path.localeCompare(b.path))

    return {
      id: `${scope}:${ownerId}`,
      scope,
      ownerId,
      baseRef,
      headRef,
      clean: files.length === 0,
      files,
      generatedAt: new Date().toISOString()
    }
  }

  async commit(
    workingDirectory: string,
    scope: WorkspaceDiffSummary['scope'],
    ownerId: string,
    payload: WorkspaceCommitPayload = {}
  ): Promise<WorkspaceCommitResult> {
    await this.ensureGitRepository(workingDirectory)
    await this.git(workingDirectory, ['add', '-A', '--', ...VISIBLE_PATHSPECS])

    const staged = await this.git(workingDirectory, [
      'diff',
      '--cached',
      '--name-only',
      '-z',
      '--',
      ...VISIBLE_PATHSPECS
    ])
    if (!staged.replace(/\0/g, '').trim()) {
      await this.updateCheckpoint(workingDirectory, scope, ownerId)
      return {
        committed: false,
        commitHash: null,
        message: null,
        diff: await this.summarize(workingDirectory, scope, ownerId)
      }
    }

    const message = this.normalizeCommitMessage(payload.message)
    try {
      await this.git(workingDirectory, ['commit', '-m', message], [0])
    } catch (err) {
      throw new Error(`Failed to commit workspace changes: ${this.errMsg(err)}`)
    }

    const commitHash = (await this.git(workingDirectory, ['rev-parse', 'HEAD'])).trim() || null
    await this.updateCheckpoint(workingDirectory, scope, ownerId)
    return {
      committed: true,
      commitHash,
      message,
      diff: await this.summarize(workingDirectory, scope, ownerId)
    }
  }

  private async ensureGitRepository(workingDirectory: string): Promise<void> {
    try {
      await mkdir(workingDirectory, { recursive: true })
      if (!(await this.isInsideGitWorkTree(workingDirectory))) {
        await this.git(workingDirectory, ['init', '-b', 'main'])
      }
      await this.git(workingDirectory, ['config', 'user.email', 'agenthub@local'])
      await this.git(workingDirectory, ['config', 'user.name', 'AgentHub'])
    } catch (err) {
      throw new Error(
        `Failed to prepare workspace git repository (${workingDirectory}): ${this.errMsg(err)}`
      )
    }
  }

  private async isInsideGitWorkTree(workingDirectory: string): Promise<boolean> {
    try {
      const value = (
        await this.git(workingDirectory, ['rev-parse', '--is-inside-work-tree'])
      ).trim()
      return value === 'true'
    } catch {
      return false
    }
  }

  private async currentHead(workingDirectory: string): Promise<string | null> {
    try {
      return (await this.git(workingDirectory, ['rev-parse', '--short', 'HEAD'])).trim()
    } catch {
      return null
    }
  }

  private async currentCheckpoint(
    workingDirectory: string,
    scope: WorkspaceDiffSummary['scope'],
    ownerId: string
  ): Promise<string | null> {
    try {
      return (
        await this.git(workingDirectory, [
          'rev-parse',
          '--short',
          this.checkpointRef(scope, ownerId)
        ])
      ).trim()
    } catch {
      return null
    }
  }

  private async updateCheckpoint(
    workingDirectory: string,
    scope: WorkspaceDiffSummary['scope'],
    ownerId: string
  ): Promise<void> {
    const head = await this.currentHead(workingDirectory)
    if (!head) return
    await this.git(workingDirectory, ['update-ref', this.checkpointRef(scope, ownerId), 'HEAD'])
  }

  private checkpointRef(scope: WorkspaceDiffSummary['scope'], ownerId: string): string {
    const safeOwnerId = ownerId.replace(/[^A-Za-z0-9._-]/g, '-')
    return `refs/agenthub/workspace-diff/${scope}/${safeOwnerId}`
  }

  private async diffEntries(workingDirectory: string, baseRef: DiffBase): Promise<StatusEntry[]> {
    if (!baseRef) return this.statusEntries(workingDirectory)

    const byPath = new Map<string, StatusEntry>()
    for (const entry of await this.nameStatusEntries(workingDirectory, baseRef)) {
      byPath.set(entry.path, entry)
    }
    for (const entry of await this.statusEntries(workingDirectory)) {
      if (entry.status !== 'untracked') continue
      byPath.set(entry.path, entry)
    }
    return [...byPath.values()]
  }

  private async nameStatusEntries(
    workingDirectory: string,
    baseRef: string
  ): Promise<StatusEntry[]> {
    const raw = await this.git(workingDirectory, [
      'diff',
      '--name-status',
      '-z',
      baseRef,
      '--',
      ...VISIBLE_PATHSPECS
    ])
    const records = raw.split('\0').filter(Boolean)
    const entries: StatusEntry[] = []

    for (let i = 0; i < records.length; ) {
      const statusToken = records[i++] ?? ''
      const statusCode = statusToken[0] ?? ''
      if (!statusCode) continue

      let oldPath: string | null = null
      let path = this.normalizeGitPath(records[i++] ?? '')
      if (statusCode === 'R' || statusCode === 'C') {
        oldPath = path
        path = this.normalizeGitPath(records[i++] ?? '')
      }

      entries.push({
        path,
        oldPath,
        xy: statusCode,
        status: this.mapNameStatus(statusCode)
      })
    }

    return entries
  }

  private async statusEntries(workingDirectory: string): Promise<StatusEntry[]> {
    const raw = await this.git(workingDirectory, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ])
    const records = raw.split('\0').filter(Boolean)
    const entries: StatusEntry[] = []

    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (record.length < 4) continue
      const xy = record.slice(0, 2)
      const path = this.normalizeGitPath(record.slice(3))
      let oldPath: string | null = null

      if (xy.includes('R') || xy.includes('C')) {
        oldPath = this.normalizeGitPath(records[i + 1] ?? '')
        i += 1
      }

      entries.push({
        path,
        oldPath: oldPath || null,
        xy,
        status: this.mapStatus(xy)
      })
    }

    return entries
  }

  private mapStatus(xy: string): WorkspaceDiffFileStatus {
    if (xy === '??') return 'untracked'
    if (xy.includes('R')) return 'renamed'
    if (xy.includes('D') && !xy.includes('A')) return 'deleted'
    if (xy.includes('A')) return 'added'
    if (xy.includes('M')) return 'modified'
    return 'other'
  }

  private mapNameStatus(status: string): WorkspaceDiffFileStatus {
    if (status === 'R') return 'renamed'
    if (status === 'D') return 'deleted'
    if (status === 'A') return 'added'
    if (status === 'M') return 'modified'
    return 'other'
  }

  private async fileSummary(
    workingDirectory: string,
    entry: StatusEntry,
    baseRef: DiffBase
  ): Promise<WorkspaceDiffFile> {
    const stats = await this.lineStats(workingDirectory, entry, baseRef)
    const base: WorkspaceDiffFile = {
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: entry.status,
      additions: stats.additions,
      deletions: stats.deletions,
      diff: null,
      expandable: false,
      tooLarge: stats.tooLargeHint
    }

    if (entry.status === 'deleted' || stats.binary) return base
    if (stats.additions + stats.deletions > MAX_DIFF_LINES) {
      return { ...base, tooLarge: true }
    }

    const diff = await this.fileDiff(workingDirectory, entry, baseRef)
    if (!diff) return base

    const tooLarge =
      Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES ||
      diff.split(/\r?\n/).length > MAX_DIFF_LINES
    return {
      ...base,
      diff: tooLarge ? null : diff,
      expandable: !tooLarge,
      tooLarge
    }
  }

  private async lineStats(
    workingDirectory: string,
    entry: StatusEntry,
    baseRef: DiffBase
  ): Promise<LineStats> {
    if (entry.status === 'untracked' || !baseRef) {
      return this.untrackedStats(workingDirectory, entry.path)
    }

    try {
      const out = await this.git(workingDirectory, ['diff', '--numstat', baseRef, '--', entry.path])
      const line = out.split(/\r?\n/).find(Boolean)
      if (!line) return { additions: 0, deletions: 0, binary: false, tooLargeHint: false }
      const [added, deleted] = line.split('\t')
      const binary = added === '-' || deleted === '-'
      return {
        additions: binary ? 0 : Number(added) || 0,
        deletions: binary ? 0 : Number(deleted) || 0,
        binary,
        tooLargeHint: false
      }
    } catch (err) {
      this.logger.warn(`Failed to read git numstat for ${entry.path}: ${this.errMsg(err)}`)
      return { additions: 0, deletions: 0, binary: false, tooLargeHint: false }
    }
  }

  private async untrackedStats(workingDirectory: string, path: string): Promise<LineStats> {
    try {
      const file = resolve(workingDirectory, path)
      const info = await stat(file)
      if (!info.isFile()) {
        return { additions: 0, deletions: 0, binary: false, tooLargeHint: false }
      }
      if (info.size > MAX_FILE_INSPECT_BYTES) {
        return { additions: 0, deletions: 0, binary: false, tooLargeHint: true }
      }
      const content = await readFile(file)
      const binary = content.includes(0)
      if (binary) return { additions: 0, deletions: 0, binary: true, tooLargeHint: false }
      const text = content.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      const additions =
        text.length === 0
          ? 0
          : text.endsWith('\n')
            ? text.slice(0, -1).split('\n').length
            : text.split('\n').length
      return {
        additions,
        deletions: 0,
        binary: false,
        tooLargeHint: info.size > MAX_DIFF_BYTES
      }
    } catch (err) {
      this.logger.warn(`Failed to inspect untracked file ${path}: ${this.errMsg(err)}`)
      return { additions: 0, deletions: 0, binary: false, tooLargeHint: false }
    }
  }

  private async fileDiff(
    workingDirectory: string,
    entry: StatusEntry,
    baseRef: DiffBase
  ): Promise<string | null> {
    try {
      if (entry.status === 'untracked' || !baseRef) {
        return await this.git(
          workingDirectory,
          ['diff', '--no-index', '--', '/dev/null', resolve(workingDirectory, entry.path)],
          [0, 1]
        )
      }
      return await this.git(workingDirectory, ['diff', baseRef, '--', entry.path])
    } catch (err) {
      this.logger.warn(`Failed to render diff for ${entry.path}: ${this.errMsg(err)}`)
      return null
    }
  }

  private normalizeCommitMessage(message?: string): string {
    const normalized = message?.trim().replace(/\s+/g, ' ')
    return normalized || DEFAULT_COMMIT_MESSAGE
  }

  private isIgnoredPath(path: string): boolean {
    const normalized = this.normalizeGitPath(path)
    return (
      IGNORED_EXACT_PATHS.has(normalized) ||
      IGNORED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    )
  }

  private normalizeGitPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '')
  }

  private async git(
    workingDirectory: string,
    args: string[],
    allowedExitCodes: number[] = [0]
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: GIT_MAX_BUFFER
      })
      return stdout
    } catch (err) {
      const code =
        typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null
      if (code !== null && allowedExitCodes.includes(code)) {
        return String((err as { stdout?: unknown }).stdout ?? '')
      }
      throw err
    }
  }

  private errMsg(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
  }
}
