import { Injectable } from '@nestjs/common'
import { resolve } from 'node:path'
import type { BlackboardArtifactPreview } from '@agenthub/shared'
import { buildArtifactPreview, ArtifactPreviewError } from '@agenthub/agent-core'
import { BusinessException } from '../../common/index.js'
import { BlackboardService } from './blackboard/blackboard.service.js'
import { GroupWorkspaceService } from './group-workspace.service.js'

/**
 * Reads a blackboard artifact's workspace file and produces a UI-friendly preview payload.
 * The file path always comes from the blackboard artifact, never from client input. The
 * file → preview logic lives in the framework-agnostic `buildArtifactPreview`
 * (@agenthub/agent-core); this service only resolves the artifact's repo + path and
 * attaches the blackboard artifact metadata.
 */
@Injectable()
export class GroupArtifactPreviewService {
    constructor(
        private readonly blackboard: BlackboardService,
        private readonly workspace: GroupWorkspaceService
    ) {}

    async preview(
        groupId: string,
        workspaceDir: string,
        artifactId: string
    ): Promise<BlackboardArtifactPreview> {
        const artifact = await this.blackboard.getArtifactById(groupId, artifactId)
        if (!artifact) throw BusinessException.notFound(`Artifact ${artifactId} not found`)

        const repo = resolve(this.workspace.repoDir(groupId, workspaceDir))
        const file = await this.buildPreview(repo, artifact.path)
        return { artifact, ...file }
    }

    private async buildPreview(repo: string, path: string) {
        try {
            return await buildArtifactPreview(repo, path)
        } catch (err) {
            throw this.toBusiness(err, path)
        }
    }

    private toBusiness(err: unknown, path: string): BusinessException {
        if (err instanceof ArtifactPreviewError) {
            if (err.reason === 'not_found') return BusinessException.notFound(err.message)
            if (err.reason === 'forbidden') return BusinessException.forbidden(err.message)
            return BusinessException.badRequest(err.message)
        }
        return BusinessException.badRequest(`Artifact ${path} preview failed`)
    }
}
