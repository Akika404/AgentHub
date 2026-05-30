import type { McpServerConfig, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
    AgentAdapter,
    AgentAdapterConfig,
    AgentCapabilities,
    AgentEvent,
    AgentTodoItem,
    AgentTodoStatus,
    AgentUsage,
    SendOptions
} from './types.js'
import { CLAUDE_CAPABILITIES } from './capabilities.js'

/** Claude 端默认工具白名单（config.allowedTools 未配置时使用） */
const DEFAULT_CLAUDE_TOOLS = [
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'Bash',
    'TodoWrite',
    'TaskCreate',
    'TaskUpdate',
    'TaskList',
    'TaskGet'
]

/**
 * 把 Claude SDK 的 effort 字段映射过去。
 * Claude 支持 low/medium/high/xhigh/max；codex 还有 'minimal'。
 */
function mapEffort(e: AgentAdapterConfig['reasoningEffort']): Options['effort'] | undefined {
    if (!e) return undefined
    if (e === 'minimal') return 'low'
    return e
}

/** 从 Claude content block 中提取一条可读的 stringified output */
function stringifyToolResult(content: unknown): unknown {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        // BetaContentBlock[] 形态：[{type:"text", text:"..."}]
        const parts = content
            .map((b) => {
                if (b && typeof b === 'object' && 'text' in b) {
                    return (b as { text: unknown }).text
                }
                return b
            })
            .filter((x) => x !== undefined)
        if (parts.every((p) => typeof p === 'string')) return parts.join('\n')
        return parts
    }
    return content
}

/** 老版 TodoWrite 工具的 input 形状 (整批替换 todos) */
interface ClaudeTodoInput {
    todos?: Array<{
        content: string
        status: AgentTodoStatus
        activeForm?: string
    }>
}

/** 新版 TaskCreate 工具 input */
interface ClaudeTaskCreateInput {
    subject?: string
    description?: string
    activeForm?: string
}

/** 新版 TaskUpdate 工具 input */
interface ClaudeTaskUpdateInput {
    taskId?: string
    subject?: string
    status?: AgentTodoStatus | 'deleted'
}

/** 新版任务管理工具集合,统一拦截 */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

/** 仅当 status 是合法三态值时通过；否则降级为 pending */
function normalizeTodoStatus(s: unknown): AgentTodoStatus {
    if (s === 'in_progress' || s === 'completed') return s
    return 'pending'
}

export class ClaudeAdapter implements AgentAdapter {
    readonly vendor = 'claude' as const
    readonly id: string
    private _sessionId: string | null = null
    /** session_started 在实例生命周期内只发一次；与 _sessionId 的更新解耦 */
    private sessionStartedEmitted = false
    private readonly config: AgentAdapterConfig
    private busy = false
    /**
     * 已被翻译成 `todo` 事件的工具调用 tool_use_id 集合。
     * 用于在后续 user 消息中过滤掉对应的 tool_result，避免上层看到孤儿结果。
     * 涉及的工具:老版 TodoWrite 与新版 TaskCreate/TaskUpdate/TaskList/TaskGet
     */
    private suppressedToolUseIds = new Set<string>()

    /**
     * 新版任务管理工具(TaskCreate/TaskUpdate)是增量操作,
     * adapter 内自己维护一份任务表,每次操作后吐一次完整快照。
     */
    private tasks = new Map<string, AgentTodoItem>()
    private taskOrder: string[] = []
    private nextTaskId = 1

    constructor(config: AgentAdapterConfig) {
        this.config = config
        this.id = config.id ?? `claude-${Math.random().toString(36).slice(2, 8)}`
    }

    get sessionId(): string | null {
        return this._sessionId
    }

    resumeWith(sdkSessionId: string): void {
        this._sessionId = sdkSessionId
        // 恢复来的会话已建立过，不再重复发 session_started
        this.sessionStartedEmitted = true
    }

    capabilities(): AgentCapabilities {
        return CLAUDE_CAPABILITIES
    }

    /** 当前任务表的有序快照(按创建顺序) */
    private snapshotTasks(): AgentTodoItem[] {
        return this.taskOrder
            .filter((id) => this.tasks.has(id))
            .map((id) => ({ ...this.tasks.get(id)! }))
    }

    async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent> {
        if (this.busy) {
            throw new Error(
                `ClaudeAdapter[${this.id}] is busy — wait for the previous send() to finish`
            )
        }
        this.busy = true

        const abortController = new AbortController()
        if (options?.signal) {
            if (options.signal.aborted) abortController.abort()
            else
                options.signal.addEventListener('abort', () => abortController.abort(), {
                    once: true
                })
        }

        // 权限模式：未配置时沿用 bypassPermissions（自动化全开）。
        // 仅 bypass 时附带 allowDangerouslySkipPermissions；其它模式留给 phase-2 接 canUseTool。
        const permissionMode = this.config.permissionMode ?? 'bypassPermissions'

        // 构造 Claude SDK 选项
        const opts: Options = {
            cwd: this.config.workingDirectory,
            model: this.config.model,
            allowedTools: this.config.allowedTools ?? DEFAULT_CLAUDE_TOOLS,
            permissionMode,
            allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
            settingSources: [],
            abortController,
            env: {
                ...process.env,
                ...this.config.env,
                ANTHROPIC_API_KEY: this.config.apiKey,
                ...(this.config.baseUrl ? { ANTHROPIC_BASE_URL: this.config.baseUrl } : {})
            }
        }
        if (this.config.systemPrompt) opts.systemPrompt = this.config.systemPrompt
        if (this.config.skills) opts.skills = this.config.skills
        if (this.config.mcpServers) {
            opts.mcpServers = this.config.mcpServers as Record<string, McpServerConfig>
        }
        const effort = mapEffort(this.config.reasoningEffort)
        if (effort) opts.effort = effort
        if (this._sessionId) opts.resume = this._sessionId

        let finalText: string | undefined
        let usage: AgentUsage | undefined
        let success = true
        let yieldedTurnStart = false

        try {
            // 触发 turn_started（Claude SDK 没有显式 turn 概念，由我们合成）
            yield { type: 'turn_started', vendor: this.vendor }
            yieldedTurnStart = true

            for await (const msg of query({ prompt, options: opts }) as AsyncIterable<SDKMessage>) {
                for (const ev of this.translate(msg)) {
                    if (ev.type === 'turn_completed') {
                        finalText = ev.finalText
                        usage = ev.usage
                    }
                    yield ev
                }
            }
        } catch (err) {
            success = false
            yield {
                type: 'error',
                vendor: this.vendor,
                message: err instanceof Error ? err.message : String(err),
                fatal: true
            }
        } finally {
            if (!yieldedTurnStart) {
                // 异常太早，至少补一个 done
            }
            yield {
                type: 'done',
                vendor: this.vendor,
                success,
                finalText,
                usage
            }
            this.busy = false
        }
    }

    /** 把单条 SDKMessage 翻译成 0 或多个 AgentEvent */
    private *translate(msg: SDKMessage): Iterable<AgentEvent> {
        // 记录 sessionId（init 或任意带 session_id 的消息）。
        // resume 续聊时 Claude 可能轮换 session_id，因此每次都把 _sessionId 更新为最新值，
        // 但 session_started 在实例生命周期内只发一次（避免上层误判为新会话）。
        if ('session_id' in msg && msg.session_id) {
            this._sessionId = msg.session_id
            if (!this.sessionStartedEmitted) {
                this.sessionStartedEmitted = true
                yield { type: 'session_started', vendor: this.vendor, sessionId: msg.session_id }
            }
        }

        switch (msg.type) {
            case 'assistant': {
                const content = msg.message?.content
                if (!Array.isArray(content)) return
                for (const block of content) {
                    const b = block as unknown as { type: string; [k: string]: unknown }
                    if (b.type === 'text' && typeof b.text === 'string') {
                        yield {
                            type: 'text',
                            vendor: this.vendor,
                            text: b.text
                        }
                    } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
                        yield {
                            type: 'thinking',
                            vendor: this.vendor,
                            text: b.thinking
                        }
                    } else if (b.type === 'tool_use') {
                        const id = String(b.id ?? '')
                        const name = String(b.name ?? '')
                        // 老版 TodoWrite: 整批替换
                        if (name === 'TodoWrite') {
                            const input = b.input as ClaudeTodoInput | undefined
                            const items: AgentTodoItem[] = (input?.todos ?? []).map((t) => ({
                                text: t.content,
                                status: normalizeTodoStatus(t.status)
                            }))
                            this.tasks.clear()
                            this.taskOrder = []
                            items.forEach((it, i) => {
                                const tid = String(i + 1)
                                this.tasks.set(tid, it)
                                this.taskOrder.push(tid)
                            })
                            this.nextTaskId = items.length + 1
                            this.suppressedToolUseIds.add(id)
                            yield { type: 'todo', vendor: this.vendor, items }
                            continue
                        }
                        // 新版 TaskCreate / TaskUpdate / TaskList / TaskGet:增量操作
                        if (TASK_TOOLS.has(name)) {
                            this.suppressedToolUseIds.add(id)
                            if (name === 'TaskCreate') {
                                const input = b.input as ClaudeTaskCreateInput | undefined
                                const tid = String(this.nextTaskId++)
                                this.tasks.set(tid, {
                                    text: input?.subject ?? '(untitled)',
                                    status: 'pending'
                                })
                                this.taskOrder.push(tid)
                                yield {
                                    type: 'todo',
                                    vendor: this.vendor,
                                    items: this.snapshotTasks()
                                }
                            } else if (name === 'TaskUpdate') {
                                const input = b.input as ClaudeTaskUpdateInput | undefined
                                const tid = input?.taskId
                                if (tid && this.tasks.has(tid)) {
                                    if (input?.status === 'deleted') {
                                        this.tasks.delete(tid)
                                        this.taskOrder = this.taskOrder.filter((x) => x !== tid)
                                    } else {
                                        const existing = this.tasks.get(tid)!
                                        if (input?.subject) existing.text = input.subject
                                        if (
                                            input?.status === 'pending' ||
                                            input?.status === 'in_progress' ||
                                            input?.status === 'completed'
                                        ) {
                                            existing.status = input.status
                                        }
                                    }
                                }
                                yield {
                                    type: 'todo',
                                    vendor: this.vendor,
                                    items: this.snapshotTasks()
                                }
                            }
                            // TaskList / TaskGet 只读,直接吞掉,不重发快照
                            continue
                        }
                        yield {
                            type: 'tool_use',
                            vendor: this.vendor,
                            id,
                            name,
                            input: b.input,
                            // Claude 的 assistant tool_use 块只是"发起"，完成与否要看后续的 tool_result
                            status: 'started'
                        }
                    }
                }
                return
            }
            case 'user': {
                // user 消息可能携带 tool_result（来自上一次 tool 调用的结果）
                const content = msg.message?.content
                if (!Array.isArray(content)) return
                for (const block of content) {
                    const b = block as unknown as { type: string; [k: string]: unknown }
                    if (b.type === 'tool_result') {
                        const toolUseId = String(b.tool_use_id ?? '')
                        // 被归一成 todo 事件的 TodoWrite 调用，其结果也不上抛
                        if (this.suppressedToolUseIds.has(toolUseId)) {
                            this.suppressedToolUseIds.delete(toolUseId)
                            continue
                        }
                        yield {
                            type: 'tool_result',
                            vendor: this.vendor,
                            toolUseId,
                            output: stringifyToolResult(b.content),
                            isError: Boolean(b.is_error)
                        }
                    }
                }
                return
            }
            case 'result': {
                if (msg.subtype === 'success') {
                    yield {
                        type: 'turn_completed',
                        vendor: this.vendor,
                        finalText: msg.result,
                        usage: {
                            inputTokens: msg.usage?.input_tokens,
                            outputTokens: msg.usage?.output_tokens,
                            cachedInputTokens: msg.usage?.cache_read_input_tokens,
                            totalCostUSD: msg.total_cost_usd
                        }
                    }
                } else {
                    yield {
                        type: 'error',
                        vendor: this.vendor,
                        message: `Claude turn ended with subtype=${msg.subtype}`
                    }
                    yield { type: 'turn_completed', vendor: this.vendor }
                }
                return
            }
            // 其它系统/状态消息暂时不上抛
            default:
                return
        }
    }
}
