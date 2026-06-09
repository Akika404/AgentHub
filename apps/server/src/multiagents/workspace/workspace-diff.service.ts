import { Injectable, Logger } from '@nestjs/common'
import { WorkspaceGit } from '@agenthub/agent-core'
import type {
    WorkspaceCommitPayload,
    WorkspaceCommitResult,
    WorkspaceDiffSummary
} from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'

/**
 * 服务器侧 workspace diff/commit 门面。
 *
 * git 逻辑已抽到框架无关的 `WorkspaceGit`（`@agenthub/agent-core`），以便桌面端
 * 本地 runner 在用户本机仓库上复用同一套实现。本服务只负责：注入 Nest Logger、
 * 把 `WorkspaceGit` 抛出的普通 `Error` 映射回统一的 `BusinessException`。
 */
@Injectable()
export class WorkspaceDiffService {
    private readonly logger = new Logger(WorkspaceDiffService.name)
    private readonly git = new WorkspaceGit(this.logger)

    async markCheckpoint(
        workingDirectory: string,
        scope: WorkspaceDiffSummary['scope'],
        ownerId: string
    ): Promise<void> {
        try {
            await this.git.markCheckpoint(workingDirectory, scope, ownerId)
        } catch (err) {
            throw this.toBusiness(err, { workingDirectory })
        }
    }

    async summarize(
        workingDirectory: string,
        scope: WorkspaceDiffSummary['scope'],
        ownerId: string
    ): Promise<WorkspaceDiffSummary> {
        try {
            return await this.git.summarize(workingDirectory, scope, ownerId)
        } catch (err) {
            throw this.toBusiness(err, { workingDirectory })
        }
    }

    async commit(
        workingDirectory: string,
        scope: WorkspaceDiffSummary['scope'],
        ownerId: string,
        payload: WorkspaceCommitPayload = {}
    ): Promise<WorkspaceCommitResult> {
        try {
            return await this.git.commit(workingDirectory, scope, ownerId, payload)
        } catch (err) {
            throw this.toBusiness(err, { workingDirectory })
        }
    }

    private toBusiness(err: unknown, details: Record<string, unknown>): BusinessException {
        if (err instanceof BusinessException) return err
        const message = err instanceof Error ? err.message : String(err)
        return BusinessException.badRequest(message, details)
    }
}
