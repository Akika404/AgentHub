import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { BlackboardView } from '@agenthub/shared'

const SENSITIVE_KEY = /(api[_-]?key|token|secret|password|authorization|credential)/i
const DEFAULT_MAX_CHARS = 4_000
const MAX_ARRAY_ITEMS = 60
const MAX_DEPTH = 8

@Injectable()
export class GroupDebugLogger {
    private readonly logger = new Logger(GroupDebugLogger.name)
    private readonly enabled: boolean
    private readonly maxChars: number

    constructor(config: ConfigService) {
        this.enabled = config.get<string>('GROUP_DEBUG_LOGS', 'true') !== 'false'
        const configuredMax = Number(config.get<string>('GROUP_DEBUG_LOG_MAX_CHARS', '4000'))
        this.maxChars =
            Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_CHARS
    }

    log(tag: string, payload: Record<string, unknown>): void {
        if (!this.enabled) return
        const sanitized = this.sanitize(payload)
        const entry = this.isPlainObject(sanitized)
            ? { tag, ...sanitized }
            : { tag, payload: sanitized }
        this.logger.debug(this.stringify(entry))
    }

    compactText(text: string | null | undefined): string | null {
        if (text === null || text === undefined) return null
        return this.truncate(text)
    }

    blackboardSnapshot(view: BlackboardView): Record<string, unknown> {
        return {
            counts: {
                artifacts: view.artifacts.length,
                decisions: view.decisions.length,
                contracts: view.contracts.length,
                tasks: view.taskGraph.length
            },
            artifacts: view.artifacts.map((a) => ({
                id: a.id,
                path: a.path,
                type: a.type,
                status: a.status,
                version: a.version,
                ownerAgentId: a.ownerAgentId,
                updatedByAgentId: a.updatedByAgentId,
                summary: a.summary
            })),
            decisions: view.decisions.map((d) => ({
                id: d.id,
                status: d.status,
                scope: d.scope,
                createdByAgentId: d.createdByAgentId,
                approvedBy: d.approvedBy,
                supersedes: d.supersedes,
                content: d.content,
                rationale: d.rationale
            })),
            contracts: view.contracts.map((c) => ({
                id: c.id,
                ownerAgentId: c.ownerAgentId,
                consumers: c.consumers,
                approvalRequired: c.approvalRequired,
                version: c.version,
                spec: c.spec
            })),
            taskGraph: view.taskGraph.map((t) => ({
                id: t.id,
                name: t.name,
                agentId: t.agentId,
                deps: t.deps,
                status: t.status,
                objective: t.objective
            }))
        }
    }

    private sanitize(value: unknown, depth = 0): unknown {
        if (depth > MAX_DEPTH) return '[MaxDepth]'
        if (value === null || value === undefined) return value
        if (typeof value === 'string') return this.truncate(value)
        if (typeof value === 'number' || typeof value === 'boolean') return value
        if (typeof value === 'bigint') return value.toString()
        if (value instanceof Date) return value.toISOString()
        if (Array.isArray(value)) {
            const items = value
                .slice(0, MAX_ARRAY_ITEMS)
                .map((item) => this.sanitize(item, depth + 1))
            if (value.length > MAX_ARRAY_ITEMS) {
                items.push(`[${value.length - MAX_ARRAY_ITEMS} more item(s) omitted]`)
            }
            return items
        }
        if (typeof value === 'object') {
            const out: Record<string, unknown> = {}
            for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
                out[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : this.sanitize(item, depth + 1)
            }
            return out
        }
        return String(value)
    }

    private truncate(value: string): string {
        if (value.length <= this.maxChars) return value
        return `${value.slice(0, this.maxChars)}…[truncated ${value.length - this.maxChars} chars]`
    }

    private stringify(value: unknown): string {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }

    private isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value)
    }
}
