import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { BusinessException } from '../../common/index.js'

const execFileAsync = promisify(execFile)

/** 一个任务 worktree 合并回主分支前识别出的改动文件 */
export interface GroupChangedFile {
    /** 相对共享仓库根的路径 */
    path: string
    /** git name-status：A 新增 / M 修改 / D 删除 / R 重命名 等 */
    status: string
}

/**
 * GroupWorkspaceService — 群聊共享 git 工作区的生命周期管理。
 *
 * 目录布局（GROUP_WORKSPACE_ROOT 默认 ~/.agenthub/groups）：
 *   <root>/<groupId>/repo            默认共享仓库（未传 workspaceDir 时）
 *   <root>/<groupId>/worktrees/<id>  每个派发任务的隔离 worktree（分支 task/<id>）
 *
 * 若建群传入 workspaceDir，则该目录作为共享仓库；worktrees / members 仍放在
 * <root>/<groupId>/ 下。删除群聊时不删除任何目录，只把共享仓库根的 ACTIVE 标记
 * 写成 false。
 *
 * 本 spec 串行执行，worktree 仅需保证生命周期正确（创建 → 合并 → 清理），
 * 不处理并发冲突（留第二份 spec）。
 */
@Injectable()
export class GroupWorkspaceService {
    private readonly logger = new Logger(GroupWorkspaceService.name)
    private readonly root: string

    constructor(private readonly config: ConfigService) {
        const configured = this.config.get<string>('GROUP_WORKSPACE_ROOT')?.trim()
        this.root = configured
            ? resolve(configured)
            : resolve(join(homedir(), '.agenthub', 'groups'))
    }

    repoDir(groupId: string, workspaceDir?: string | null): string {
        const custom = workspaceDir?.trim()
        return custom ? resolve(custom) : join(this.root, groupId, 'repo')
    }

    /** 某成员在本群复用的会话私有 home（SDK 状态隔离、vendor 配置发现目录基底）。 */
    memberHomeDir(groupId: string, agentId: string): string {
        return join(this.root, groupId, 'members', agentId, 'home')
    }

    private worktreeDir(groupId: string, taskId: string): string {
        return join(this.root, groupId, 'worktrees', taskId)
    }

    private branchName(taskId: string): string {
        return `task/${taskId}`
    }

    /**
     * 建群：创建/复用共享仓库目录、`git init`、配置提交身份，并确保有 HEAD。
     * 传入 workspaceDir 时优先使用用户指定目录；否则使用服务默认分配目录。
     */
    async createWorkspace(groupId: string, workspaceDir?: string | null): Promise<string> {
        const repo = this.repoDir(groupId, workspaceDir)
        try {
            await mkdir(repo, { recursive: true })
            const isGit = await this.isGitRepositoryRoot(repo)
            if (!isGit) await this.git(repo, ['init', '-b', 'main'])
            await this.git(repo, ['config', 'user.email', 'agenthub@local'])
            await this.git(repo, ['config', 'user.name', 'AgentHub'])
            await this.ensureInitialCommit(repo)
            await this.writeActiveMarker(repo, true)
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to initialize group workspace: ${this.errMsg(err)}`,
                { repo, userProvided: Boolean(workspaceDir?.trim()) }
            )
        }
        return repo
    }

    /**
     * 为一个派发任务创建 worktree + 分支 task/<taskId>，从 HEAD 切出。返回 worktree 路径。
     *
     * 幂等：suspend→resume（成员挂起等用户答复后再恢复）会以同一 taskId 再次进入。
     * - worktree 已登记 → 直接复用（保留成员的草稿改动，保证续接连续性）；
     * - 仅分支存在（worktree 曾被清理）→ 用既有分支重建 worktree；
     * - 都不存在 → 新建分支 + worktree。
     */
    async createTaskWorktree(
        groupId: string,
        taskId: string,
        workspaceDir?: string | null
    ): Promise<string> {
        const repo = this.repoDir(groupId, workspaceDir)
        const wt = this.worktreeDir(groupId, taskId)
        const branch = this.branchName(taskId)
        try {
            await mkdir(join(this.root, groupId, 'worktrees'), { recursive: true })
            if (await this.worktreeRegistered(repo, wt)) return wt
            if (await this.branchExists(repo, branch)) {
                await this.git(repo, ['worktree', 'add', wt, branch])
            } else {
                await this.git(repo, ['worktree', 'add', '-b', branch, wt, 'HEAD'])
            }
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to create task worktree: ${this.errMsg(err)}`,
                { groupId, taskId, wt }
            )
        }
        return wt
    }

    /** 分支 refs/heads/<branch> 是否存在（用于挂起恢复时复用既有任务分支）。 */
    private async branchExists(repo: string, branch: string): Promise<boolean> {
        try {
            await this.git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
            return true
        } catch {
            return false
        }
    }

    /** worktree 路径是否已在该仓库登记（用于挂起恢复时复用既有 worktree，保留草稿）。 */
    private async worktreeRegistered(repo: string, wt: string): Promise<boolean> {
        try {
            const list = await this.git(repo, ['worktree', 'list', '--porcelain'])
            const target = resolve(wt)
            return list
                .split('\n')
                .some(
                    (line) =>
                        line.startsWith('worktree ') &&
                        resolve(line.slice('worktree '.length).trim()) === target
                )
        } catch {
            return false
        }
    }

    /**
     * 收口前识别该任务 worktree 的改动：`git add -A` 后提交，并返回改动文件清单
     * （喂给黑板产出物更新）。无改动则返回空数组、不提交。
     */
    async diffArtifacts(groupId: string, taskId: string): Promise<GroupChangedFile[]> {
        const wt = this.worktreeDir(groupId, taskId)
        try {
            await this.git(wt, ['add', '-A'])
            const staged = (await this.git(wt, ['diff', '--cached', '--name-status'])).trim()
            if (!staged) return []
            const files = this.parseNameStatus(staged)
            await this.git(wt, ['commit', '-m', `task: ${taskId}`])
            return files
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to collect task changes: ${this.errMsg(err)}`,
                { groupId, taskId }
            )
        }
    }

    /** 把任务分支合并回主分支（串行执行，无并发冲突），随后移除 worktree 与分支。 */
    async mergeTaskWorktree(
        groupId: string,
        taskId: string,
        workspaceDir?: string | null
    ): Promise<void> {
        const repo = this.repoDir(groupId, workspaceDir)
        const wt = this.worktreeDir(groupId, taskId)
        const branch = this.branchName(taskId)
        try {
            const baseBranch = (await this.git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
            const ahead = (
                await this.git(repo, ['rev-list', '--count', `${baseBranch}..${branch}`])
            ).trim()
            if (Number(ahead) > 0) {
                await this.git(repo, ['merge', '--no-ff', '--no-edit', branch])
            }
        } catch (err) {
            // 串行执行下不应发生冲突；如发生，如实记录并继续清理（冲突仲裁留第二份 spec）
            this.logger.error(`Merge failed for task ${taskId}: ${this.errMsg(err)}`)
            throw BusinessException.conflict(
                `Failed to merge task worktree: ${this.errMsg(err)}`,
                { groupId, taskId }
            )
        } finally {
            await this.cleanupWorktree(repo, wt, branch)
        }
    }

    private async isGitRepositoryRoot(repo: string): Promise<boolean> {
        try {
            const topLevel = (await this.git(repo, ['rev-parse', '--show-toplevel'])).trim()
            return resolve(topLevel) === resolve(repo)
        } catch {
            return false
        }
    }

    private async ensureInitialCommit(repo: string): Promise<void> {
        const hasHead = await this.hasHead(repo)
        if (hasHead) {
            const dirty = await this.dirtyEntriesExceptActive(repo)
            if (dirty.length) {
                throw BusinessException.badRequest(
                    'Selected workspace is an existing git repository with uncommitted changes; commit or stash them before creating a group chat.',
                    { repo, dirty }
                )
            }
            return
        }
        await this.git(repo, ['add', '-A'])
        await this.git(repo, ['commit', '--allow-empty', '-m', 'chore: init group workspace'])
    }

    private async hasHead(repo: string): Promise<boolean> {
        try {
            await this.git(repo, ['rev-parse', '--verify', 'HEAD'])
            return true
        } catch {
            return false
        }
    }

    private async dirtyEntriesExceptActive(repo: string): Promise<string[]> {
        const status = (await this.git(repo, ['status', '--porcelain'])).trim()
        if (!status) return []
        return status
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line) => {
                const path = line.slice(3).trim()
                return path !== 'ACTIVE'
            })
    }

    private async writeActiveMarker(repo: string, active: boolean): Promise<void> {
        await writeFile(join(repo, 'ACTIVE'), active ? 'true\n' : 'false\n', 'utf8')
    }

    /** 删群：不删除任何目录，仅标记共享工作区不再 active。 */
    async removeWorkspace(groupId: string, workspaceDir?: string | null): Promise<void> {
        const repo = this.repoDir(groupId, workspaceDir)
        try {
            await this.writeActiveMarker(repo, false)
        } catch (err) {
            this.logger.warn(`Failed to mark group workspace ${groupId} inactive: ${this.errMsg(err)}`)
        }
    }

    private async cleanupWorktree(repo: string, wt: string, branch: string): Promise<void> {
        try {
            await this.git(repo, ['worktree', 'remove', '--force', wt])
        } catch (err) {
            this.logger.warn(`worktree remove failed (${wt}): ${this.errMsg(err)}`)
        }
        try {
            await this.git(repo, ['branch', '-D', branch])
        } catch (err) {
            this.logger.warn(`branch delete failed (${branch}): ${this.errMsg(err)}`)
        }
    }

    private parseNameStatus(output: string): GroupChangedFile[] {
        return output
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [status, ...rest] = line.split('\t')
                return { status: status.trim(), path: rest.join('\t').trim() }
            })
            .filter((f) => f.path)
    }

    private async git(cwd: string, args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', args, {
            cwd,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            maxBuffer: 16 * 1024 * 1024
        })
        return stdout
    }

    private errMsg(err: unknown): string {
        if (err instanceof Error) return err.message
        return String(err)
    }
}
