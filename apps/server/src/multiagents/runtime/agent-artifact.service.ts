import { Injectable, Logger } from '@nestjs/common'
import type {
    BlackboardArtifact,
    BlackboardArtifactType,
    DeployManifest,
    WorkspaceDiffFile,
    WorkspaceDiffSummary
} from '@agenthub/shared'
import { WorkspaceDiffService } from '../workspace/workspace-diff.service.js'
import { LocalRunnerGateway } from '../local-runner/local-runner.gateway.js'
import type { AgentSession } from '../entities/agent-session.entity.js'

/** 一个文件在某次快照里的内容签名,用于判断本轮是否动过它。 */
type FileSignature = string

/**
 * 单聊产物推导。
 *
 * 单聊无黑板,产物从 workspace diff 增量推导:turn 起止各取一次「相对 checkpoint 的
 * 累计 diff」快照,本轮产物 = 在结束快照中、且签名相对起始快照发生变化(或新增)的文件。
 * 这样既复用了既有的 checkpoint/summarize 设施(server 与 local 模式都已打通),又不挪动
 * checkpoint 基线(commit/diff 面板仍展示自建聊以来的累计未提交变更)。
 */
@Injectable()
export class AgentArtifactService {
    private readonly logger = new Logger(AgentArtifactService.name)

    constructor(
        private readonly workspaceDiff: WorkspaceDiffService,
        private readonly localRunner: LocalRunnerGateway
    ) {}

    /** turn 开始时的基线快照(path -> 签名);失败回退空 Map,即把本轮所有改动都算作产物。 */
    async snapshot(session: AgentSession): Promise<Map<string, FileSignature>> {
        const summary = await this.safeSummarize(session)
        return this.toSignatures(summary)
    }

    /**
     * turn 结束后据起止快照推导本轮产物 + static 预览清单。
     * 推导失败时返回空结果(不阻断 turn 收尾)。
     */
    async derive(
        session: AgentSession,
        before: Map<string, FileSignature>
    ): Promise<{ artifacts: BlackboardArtifact[]; manifest: DeployManifest | null }> {
        const summary = await this.safeSummarize(session)
        if (!summary) return { artifacts: [], manifest: null }

        const now = new Date().toISOString()
        const artifacts: BlackboardArtifact[] = []
        for (const file of summary.files) {
            if (file.status === 'deleted') continue
            const sig = this.signature(file)
            if (before.get(file.path) === sig) continue // 本轮未动
            artifacts.push(this.toArtifact(session.agentId, file.path, now))
        }
        return { artifacts, manifest: this.inferManifest(artifacts) }
    }

    private toArtifact(agentId: string, path: string, now: string): BlackboardArtifact {
        return {
            id: path,
            type: this.artifactType(path),
            path,
            ownerAgentId: agentId,
            version: 1,
            status: 'draft',
            summary: '',
            updatedAt: now,
            updatedByAgentId: agentId
        }
    }

    /** static 预览:本轮产物里若有可作入口的 HTML(优先 index.html),给一张 static 卡。 */
    private inferManifest(artifacts: BlackboardArtifact[]): DeployManifest | null {
        const htmls = artifacts.filter((a) => /\.html?$/i.test(a.path))
        if (htmls.length === 0) return null
        const entry =
            htmls.find((a) => /(^|\/)index\.html?$/i.test(a.path)) ?? htmls[0]
        return { mode: 'static', entryPath: entry.path }
    }

    private toSignatures(summary: WorkspaceDiffSummary | null): Map<string, FileSignature> {
        const map = new Map<string, FileSignature>()
        if (!summary) return map
        for (const file of summary.files) map.set(file.path, this.signature(file))
        return map
    }

    /** 用 status + 增删行数作为廉价内容签名;本轮动过文件这三者几乎必然变化。 */
    private signature(file: WorkspaceDiffFile): FileSignature {
        return `${file.status}:${file.additions}:${file.deletions}`
    }

    private async safeSummarize(session: AgentSession): Promise<WorkspaceDiffSummary | null> {
        try {
            if (session.executionMode === 'local') {
                if (!this.localRunner.isConnected(session.userId)) return null
                return await this.localRunner.rpc(session.userId, 'diff.summarize', {
                    workingDirectory: session.workingDirectory,
                    scope: 'agent-chat',
                    ownerId: session.id
                })
            }
            return await this.workspaceDiff.summarize(
                session.workingDirectory,
                'agent-chat',
                session.id
            )
        } catch (err) {
            this.logger.warn(
                `Artifact diff snapshot failed for session ${session.id}: ${this.errMsg(err)}`
            )
            return null
        }
    }

    private artifactType(path: string): BlackboardArtifactType {
        const lower = path.toLowerCase()
        if (/\.(md|txt|rst|adoc)$/.test(lower)) return 'document'
        if (/test|spec/.test(lower)) return 'test_report'
        if (/\.(png|svg|fig|sketch)$/.test(lower)) return 'design'
        return 'code'
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
