import { Injectable } from '@nestjs/common'
import { readFile, stat } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { BlackboardArtifact, DeployManifest } from '@agenthub/shared'
import {
    createAgent,
    type AgentAdapter,
    type AgentAdapterConfig,
    type AgentOutputSchema
} from '../../adapter/index.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { BlackboardService } from '../blackboard/blackboard.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'
import type { TaskOutcome } from './orchestrator.service.js'

export const ORCHESTRATOR_FINAL_REVIEWER = Symbol('ORCHESTRATOR_FINAL_REVIEWER')

export interface OrchestratorFinalReviewRequest {
    group: GroupChat
    userId: string
    runId: string
    originalUserText: string
    outcomes: TaskOutcome[]
}

export interface OrchestratorReviewArtifact {
    path: string
    type: BlackboardArtifact['type']
    status: BlackboardArtifact['status']
    version: number
    ownerAgentId: string
    summary: string
    previewKind: 'text' | 'html' | 'binary' | 'missing' | 'too_large'
    size: number | null
    content: string | null
    message: string | null
}

export interface OrchestratorFinalReviewResult {
    complete: boolean
    summary: string
    completedItems: string[]
    gaps: string[]
    followUpInstruction: string | null
    /** 可呈现交付物的部署声明；无可部署产物时为 null。 */
    deploy: DeployManifest | null
    orchestratorSessionId?: string | null
}

export interface OrchestratorFinalReviewer {
    review(req: OrchestratorFinalReviewRequest): Promise<OrchestratorFinalReviewResult>
}

interface ReviewerRunResult {
    text: string
    success: boolean
    error?: string
    structuredOutput?: unknown
    sessionId?: string | null
}

const FINAL_REVIEW_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator，负责最终验收与汇报。
你会看到：用户原始需求、成员任务结果、黑板摘要、以及产物预览。

【你的职责】
- 对照用户原始需求检查产物是否真正满足，而不是只看任务状态是否 done。
- 先判断用户原始需求要的是什么：可交付产出（页面/应用/功能/可运行代码等），还是仅规划/文档（PRD、方案、调研报告等）。验收标准要匹配需求本身，不要拔高也不要降低。
- 你必须结合成员任务状态输出最终确认/汇报：若存在 failed、blocked、waiting_input，则整体通常 complete=false，并在 summary 中明确当前状态、已完成部分、失败/阻塞/等待用户回复的部分。
- 在以下情况应判定 complete=false：产物缺失或无法对应到需求；用户要的是可交付产出，但只产出了规划/PRD/方案/设计而没有实际实现；声称实现了功能却没有任何运行、测试或检查证据。
- 若任务处于 waiting_input，summary 应直接说明正在等待用户补充什么信息；不要假装任务已经完成。
- 例外：若用户原始需求本就只要规划/文档，则交付了对应规划/文档即可判 complete=true，不要因为"没有实现"而判未完成。
- 对非文本、过大、或读取失败的产物（预览正文为空，仅有元信息或 message），结合产物元信息与成员任务结果综合判断，不要仅因正文不可读就判 complete=false。

【输出要求】
- 只输出一个 JSON 对象，不要输出代码块标记或任何额外解释。
- summary：给用户看的最终正文。complete=true 时是一段自然、具体、诚实的总结，说明完成了什么以及产物位置；complete=false 时说明当前进度与还差什么。
- completedItems：始终列出已真正交付的工作（用短句）；即使整体未完成也要如实填写已完成的部分，没有则为空数组。
- gaps：未满足或不充分的项（用短句）。complete=true 时为空数组。
- followUpInstruction：complete=false 时给一段自包含、可直接交给编排器继续派发成员任务的指令，点明还缺什么、建议交给哪类成员；complete=true 时为 null。

【部署声明 deploy】
判断本轮产物是否是一个"可以给用户直接看/运行"的交付物，据此填写 deploy（无可呈现交付物时填 null）：
- mode="static"：产物是可直接预览的单个文件（如 index.html、报告 .md/.txt），entryPath 填该文件相对工作区根的路径（如 "index.html"）。不要为需要构建/起服务才能看的项目填 static。
- mode="service"：产物是需要起 dev server 才能访问的网页项目（如 Vite/React/Vue 工程）。必须填 command（启动 dev server 的命令，如 "npm run dev"）与 port（该命令实际监听的端口，需与项目配置一致）。若依赖未安装需要先安装，填 installCommand（如 "npm install"）；entryPath 可选填项目根或入口文件。
- note：可选，一句话向用户说明这个部署是什么。
- 只在 complete=true 且确有可呈现交付物时填 deploy；纯规划/PRD/方案/设计类交付物填 null。
- command/port 必须来自你对产物的真实判断（读 package.json 的 scripts 与框架默认端口），不要臆造。`

const REVIEW_TEXT_EXTENSIONS = new Set([
    '.css',
    '.csv',
    '.html',
    '.htm',
    '.js',
    '.json',
    '.jsx',
    '.md',
    '.mdx',
    '.mjs',
    '.scss',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml'
])
const HIDDEN_ARTIFACT_DIRS = new Set(['.codex', '.agents', '.claude'])
const MAX_REVIEW_ARTIFACTS = 12
const MAX_REVIEW_ARTIFACT_BYTES = 256 * 1024
const MAX_REVIEW_ARTIFACT_CHARS = 12_000

@Injectable()
export class LlmOrchestratorFinalReviewer implements OrchestratorFinalReviewer {
    constructor(
        private readonly providers: PlatformProviderService,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly blackboard: BlackboardService,
        private readonly debug: GroupDebugLogger
    ) {}

    async review(req: OrchestratorFinalReviewRequest): Promise<OrchestratorFinalReviewResult> {
        const result = await this.runReviewer(req)
        if (!result.success) {
            throw new Error(result.error ?? 'Orchestrator final review failed')
        }
        const parsed =
            this.parseReviewObject(result.structuredOutput) ?? this.parseReviewText(result.text)
        if (!parsed) {
            this.debug.log('group.orchestrator_final_review.parse_failed', {
                groupId: req.group.id,
                runId: req.runId,
                result
            })
            throw new Error('Orchestrator final review returned invalid output')
        }
        parsed.orchestratorSessionId = result.sessionId ?? null
        this.debug.log('group.orchestrator_final_review.parsed', {
            groupId: req.group.id,
            runId: req.runId,
            review: parsed
        })
        return parsed
    }

    private async runReviewer(req: OrchestratorFinalReviewRequest): Promise<ReviewerRunResult> {
        const provider = await this.providers.resolveRuntimeConfig(
            req.userId,
            req.group.orchestratorProviderId
        )
        const home = this.workspace.memberHomeDir(
            req.group.id,
            'orchestrator',
            req.group.workspaceDir
        )
        await this.agentWorkspace.ensureAgentHomeDirectory(req.group.orchestratorVendor, home)

        const config: AgentAdapterConfig = {
            id: `orch-review-${req.group.id}`,
            model: req.group.orchestratorModel,
            agentHomeDirectory: home,
            workingDirectory: home,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            reasoningEffort: 'minimal',
            systemPrompt: FINAL_REVIEW_SYSTEM_PROMPT,
            allowedTools: [],
            permissionMode: 'default'
        }
        const adapter = this.createReviewerAdapter(req, config)
        const prompt = await this.buildPrompt(req)
        this.debug.log('group.orchestrator_final_review.prompt', {
            groupId: req.group.id,
            runId: req.runId,
            resumedSdkSessionId: req.group.orchestratorSessionId ?? null,
            prompt
        })
        const first = await this.sendReviewRequest(adapter, prompt, this.outputSchema())
        if (first.success) return first
        return this.sendReviewRequest(this.createReviewerAdapter(req, config), prompt)
    }

    private createReviewerAdapter(
        req: OrchestratorFinalReviewRequest,
        config: AgentAdapterConfig
    ): AgentAdapter {
        const adapter = createAgent(req.group.orchestratorVendor, config)
        if (req.group.orchestratorSessionId) {
            adapter.resumeWith(req.group.orchestratorSessionId)
        }
        return adapter
    }

    private async sendReviewRequest(
        adapter: ReturnType<typeof createAgent>,
        prompt: string,
        outputSchema?: AgentOutputSchema
    ): Promise<ReviewerRunResult> {
        const parts: string[] = []
        let finalFromDone: string | null = null
        let structuredOutput: unknown
        let success = true
        let error: string | undefined

        for await (const ev of adapter.send(prompt, outputSchema ? { outputSchema } : undefined)) {
            if (ev.type === 'text') parts.push(ev.text)
            else if (ev.type === 'error' && ev.fatal) {
                success = false
                error = ev.message
            } else if (ev.type === 'done') {
                success = ev.success
                if (ev.finalText) finalFromDone = ev.finalText
                structuredOutput = ev.structuredOutput
            }
        }
        const textParts = parts.map((part) => part.trim()).filter((part) => part.length > 0)
        const finalText = finalFromDone?.trim()
        if (finalText && !textParts.includes(finalText)) textParts.push(finalText)
        return {
            text: textParts.join('\n\n').trim(),
            success,
            error,
            structuredOutput,
            sessionId: adapter.sessionId
        }
    }

    private outputSchema(): AgentOutputSchema {
        return {
            type: 'object',
            properties: {
                complete: { type: 'boolean' },
                summary: { type: 'string' },
                completedItems: { type: 'array', items: { type: 'string' } },
                gaps: { type: 'array', items: { type: 'string' } },
                followUpInstruction: { type: ['string', 'null'] },
                deploy: {
                    type: ['object', 'null'],
                    properties: {
                        mode: { type: 'string', enum: ['static', 'service'] },
                        entryPath: { type: 'string' },
                        command: { type: 'string' },
                        installCommand: { type: 'string' },
                        port: { type: 'integer' },
                        note: { type: 'string' }
                    },
                    required: ['mode'],
                    additionalProperties: false
                }
            },
            required: [
                'complete',
                'summary',
                'completedItems',
                'gaps',
                'followUpInstruction',
                'deploy'
            ],
            additionalProperties: false
        }
    }

    private async buildPrompt(req: OrchestratorFinalReviewRequest): Promise<string> {
        const [blackboardSummary, artifacts] = await Promise.all([
            this.blackboard.summarize(req.group.id),
            this.collectArtifacts(req.group)
        ])
        return [
            `项目名称：${req.group.projectName}`,
            `项目目标：${req.group.projectGoal ?? '(未设定)'}`,
            `技术栈：${(req.group.projectTechStack ?? []).join(', ') || '(未设定)'}`,
            `项目状态：${req.group.projectStatus}`,
            '',
            `用户原始需求：${req.originalUserText}`,
            '',
            `成员任务结果：\n${this.renderOutcomes(req.outcomes)}`,
            '',
            `黑板摘要：\n${blackboardSummary}`,
            '',
            `产物预览：\n${this.renderArtifacts(artifacts)}`,
            '',
            '请判断这些产物是否已经满足用户原始需求，并按 JSON schema 输出最终验收结果。'
        ].join('\n')
    }

    private renderOutcomes(outcomes: TaskOutcome[]): string {
        if (outcomes.length === 0) return '(无)'
        return outcomes.map((o) => `- [${o.status}] ${o.name}: ${o.summary}`).join('\n')
    }

    private renderArtifacts(artifacts: OrchestratorReviewArtifact[]): string {
        if (artifacts.length === 0) return '(无产物)'
        return artifacts
            .map((artifact) => {
                const head = [
                    `## ${artifact.path}`,
                    `type=${artifact.type}, status=${artifact.status}, version=${artifact.version}, owner=${artifact.ownerAgentId}`,
                    `summary=${artifact.summary}`,
                    `previewKind=${artifact.previewKind}, size=${artifact.size ?? '(unknown)'}`
                ]
                if (artifact.message) head.push(`message=${artifact.message}`)
                if (artifact.content) head.push(`content:\n${artifact.content}`)
                return head.join('\n')
            })
            .join('\n\n')
    }

    private async collectArtifacts(group: GroupChat): Promise<OrchestratorReviewArtifact[]> {
        const state = await this.blackboard.getState(group.id)
        const repo = resolve(this.workspace.repoDir(group.id, group.workspaceDir))
        const artifacts = state.artifacts.slice(0, MAX_REVIEW_ARTIFACTS)
        return Promise.all(artifacts.map((artifact) => this.collectArtifact(repo, artifact)))
    }

    private async collectArtifact(
        repo: string,
        artifact: BlackboardArtifact
    ): Promise<OrchestratorReviewArtifact> {
        try {
            this.assertAllowedArtifactPath(artifact.path)
            const filePath = resolve(repo, artifact.path)
            this.assertPathInsideRepo(repo, filePath)
            const stats = await stat(filePath)
            if (!stats.isFile()) {
                return this.artifactPreview(artifact, 'missing', null, null, '产物路径不是文件')
            }
            const extension = extname(artifact.path).toLowerCase()
            const kind = extension === '.html' || extension === '.htm' ? 'html' : 'text'
            if (!REVIEW_TEXT_EXTENSIONS.has(extension)) {
                return this.artifactPreview(
                    artifact,
                    'binary',
                    stats.size,
                    null,
                    '非文本产物，仅使用元信息验收'
                )
            }
            if (stats.size > MAX_REVIEW_ARTIFACT_BYTES) {
                return this.artifactPreview(
                    artifact,
                    'too_large',
                    stats.size,
                    null,
                    '文本产物过大，未读取正文'
                )
            }
            const content = await readFile(filePath, 'utf8')
            return this.artifactPreview(
                artifact,
                kind,
                stats.size,
                this.truncate(content, MAX_REVIEW_ARTIFACT_CHARS),
                null
            )
        } catch (err) {
            return this.artifactPreview(
                artifact,
                'missing',
                null,
                null,
                err instanceof Error ? err.message : String(err)
            )
        }
    }

    private artifactPreview(
        artifact: BlackboardArtifact,
        previewKind: OrchestratorReviewArtifact['previewKind'],
        size: number | null,
        content: string | null,
        message: string | null
    ): OrchestratorReviewArtifact {
        return {
            path: artifact.path,
            type: artifact.type,
            status: artifact.status,
            version: artifact.version,
            ownerAgentId: artifact.ownerAgentId,
            summary: artifact.summary,
            previewKind,
            size,
            content,
            message
        }
    }

    private parseReviewText(text: string): OrchestratorFinalReviewResult | null {
        const json = this.extractJson(text)
        if (!json) return null
        try {
            return this.parseReviewObject(JSON.parse(json))
        } catch {
            return null
        }
    }

    private parseReviewObject(obj: unknown): OrchestratorFinalReviewResult | null {
        if (typeof obj !== 'object' || obj === null) return null
        const rec = obj as Record<string, unknown>
        if (typeof rec.complete !== 'boolean') return null
        if (typeof rec.summary !== 'string' || !rec.summary.trim()) return null
        const completedItems = this.stringArray(rec.completedItems)
        const gaps = this.stringArray(rec.gaps)
        if (!completedItems || !gaps) return null
        if (rec.followUpInstruction !== null && typeof rec.followUpInstruction !== 'string') {
            return null
        }
        return {
            complete: rec.complete,
            summary: rec.summary.trim(),
            completedItems,
            gaps,
            followUpInstruction:
                typeof rec.followUpInstruction === 'string' && rec.followUpInstruction.trim()
                    ? rec.followUpInstruction.trim()
                    : null,
            deploy: this.parseDeploy(rec.deploy)
        }
    }

    /** 校验 deploy 声明；非法/缺字段则降级为 null（宁可不出卡，也不出错卡）。 */
    private parseDeploy(raw: unknown): DeployManifest | null {
        if (typeof raw !== 'object' || raw === null) return null
        const rec = raw as Record<string, unknown>
        const mode = rec.mode
        if (mode !== 'static' && mode !== 'service') return null
        const str = (v: unknown): string | undefined =>
            typeof v === 'string' && v.trim() ? v.trim() : undefined
        if (mode === 'static') {
            const entryPath = str(rec.entryPath)
            if (!entryPath) return null
            return { mode, entryPath, ...(str(rec.note) ? { note: str(rec.note) } : {}) }
        }
        // service：command + 合法 port 必填，否则无法运行 → 降级 null
        const command = str(rec.command)
        const port = typeof rec.port === 'number' ? rec.port : undefined
        if (!command || !port || !Number.isInteger(port) || port < 1 || port > 65535) return null
        return {
            mode,
            command,
            port,
            ...(str(rec.installCommand) ? { installCommand: str(rec.installCommand) } : {}),
            ...(str(rec.entryPath) ? { entryPath: str(rec.entryPath) } : {}),
            ...(str(rec.note) ? { note: str(rec.note) } : {})
        }
    }

    private stringArray(raw: unknown): string[] | null {
        if (!Array.isArray(raw)) return null
        return raw
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
    }

    private extractJson(text: string): string | null {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
        if (fenced) return fenced[1].trim()
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        if (start >= 0 && end > start) return text.slice(start, end + 1)
        return null
    }

    private assertAllowedArtifactPath(path: string): void {
        if (!path || isAbsolute(path)) throw new Error('Artifact path must be relative')
        const segments = path.split(/[\\/]+/).filter(Boolean)
        if (segments.some((segment) => segment === '..')) {
            throw new Error('Artifact path cannot contain parent directory segments')
        }
        if (segments.some((segment) => HIDDEN_ARTIFACT_DIRS.has(segment))) {
            throw new Error('Artifact path is hidden from review')
        }
    }

    private assertPathInsideRepo(repo: string, filePath: string): void {
        const rel = relative(repo, filePath)
        if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
            throw new Error('Artifact file must be inside the group workspace')
        }
    }

    private truncate(text: string, maxChars: number): string {
        if (text.length <= maxChars) return text
        return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`
    }
}
