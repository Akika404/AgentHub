import { Codex } from "@openai/codex-sdk";
import type { Thread, ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import type {
    AgentAdapter,
    AgentAdapterConfig,
    AgentCapabilities,
    AgentEvent,
    AgentUsage,
    SendOptions,
    ToolCallStatus,
} from "./types.js";
import { CODEX_CAPABILITIES } from "./capabilities.js";

/** Codex 的 effort 取值集与统一接口对齐 */
function mapEffort(
    e: AgentAdapterConfig["reasoningEffort"],
): "minimal" | "low" | "medium" | "high" | "xhigh" | undefined {
    if (!e) return undefined;
    if (e === "max") return "xhigh";
    return e;
}

/** item.status -> 统一 ToolCallStatus；不同 item 类型的状态字段叫法不同 */
function toToolStatus(raw: unknown): ToolCallStatus {
    if (raw === "completed") return "completed";
    if (raw === "failed") return "failed";
    return "started";
}

export class CodexAdapter implements AgentAdapter {
    readonly vendor = "codex" as const;
    readonly id: string;
    private readonly config: AgentAdapterConfig;
    /** 惰性构造，首次 send 时再 new（见 ensureCodex） */
    private codex: Codex | null = null;
    private thread: Thread | null = null;
    private busy = false;
    /** 由 resumeWith() 注入的待恢复 thread id；首次 send() 时用 resumeThread 续接 */
    private resumeId: string | null = null;

    constructor(config: AgentAdapterConfig) {
        this.config = config;
        this.id = config.id ?? `codex-${Math.random().toString(36).slice(2, 8)}`;
    }

    /** 惰性构造 Codex 实例（首次 send 时复用同一实例以维持线程上下文） */
    private ensureCodex(): Codex {
        if (this.codex) return this.codex;
        const { config } = this;
        // 与现有 codex_agent.ts 对齐：使用 test_provider 把流量打到自定义网关
        this.codex = new Codex({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            config: config.baseUrl
                ? {
                      model_providers: {
                          test_provider: {
                              name: "test",
                              base_url: config.baseUrl,
                              wire_api: "responses",
                              requires_openai_auth: true,
                          },
                      },
                      model_provider: "test_provider",
                  }
                : undefined,
            env: {
                ...process.env,
                ...config.env,
            } as Record<string, string>,
        });
        return this.codex;
    }

    get sessionId(): string | null {
        return this.thread?.id ?? this.resumeId ?? null;
    }

    resumeWith(sdkSessionId: string): void {
        this.resumeId = sdkSessionId;
    }

    capabilities(): AgentCapabilities {
        return CODEX_CAPABILITIES;
    }

    async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent> {
        if (this.busy) {
            throw new Error(`CodexAdapter[${this.id}] is busy — wait for the previous send() to finish`);
        }
        this.busy = true;

        let success = true;
        let finalText: string | undefined;
        let usageOut: AgentUsage | undefined;

        try {
            // 首次调用：开新 thread 或按 resumeId 续接；之后复用以维持对话上下文。
            // 放在 try 内，确保动态加载 / 建 thread 失败也能走到 done + 释放 busy。
            // sandboxMode/approvalPolicy 本期固定为自动化全开（auto-approve），
            // 交互审批留待 phase-2（届时映射 config.permissionMode → approvalPolicy）。
            if (!this.thread) {
                const codex = this.ensureCodex();
                const effort = mapEffort(this.config.reasoningEffort);
                const threadOptions = {
                    model: this.config.model,
                    sandboxMode: "danger-full-access" as const,
                    approvalPolicy: "never" as const,
                    skipGitRepoCheck: true,
                    workingDirectory: this.config.workingDirectory,
                    ...(effort ? { modelReasoningEffort: effort } : {}),
                };
                this.thread = this.resumeId
                    ? codex.resumeThread(this.resumeId, threadOptions)
                    : codex.startThread(threadOptions);
            }

            const { events } = await this.thread.runStreamed(prompt, {
                signal: options?.signal,
            });

            for await (const ev of events) {
                for (const out of this.translate(ev)) {
                    if (out.type === "turn_completed") {
                        finalText = out.finalText;
                        usageOut = out.usage;
                    }
                    yield out;
                }
            }
        } catch (err) {
            success = false;
            yield {
                type: "error",
                vendor: this.vendor,
                message: err instanceof Error ? err.message : String(err),
                fatal: true,
            };
        } finally {
            yield {
                type: "done",
                vendor: this.vendor,
                success,
                finalText,
                usage: usageOut,
            };
            this.busy = false;
        }
    }

    /** ThreadEvent -> 0 或多个 AgentEvent */
    private *translate(ev: ThreadEvent): Iterable<AgentEvent> {
        switch (ev.type) {
            case "thread.started":
                yield {
                    type: "session_started",
                    vendor: this.vendor,
                    sessionId: ev.thread_id,
                };
                return;
            case "turn.started":
                yield { type: "turn_started", vendor: this.vendor };
                return;
            case "turn.completed":
                yield {
                    type: "turn_completed",
                    vendor: this.vendor,
                    usage: {
                        inputTokens: ev.usage.input_tokens,
                        outputTokens: ev.usage.output_tokens,
                        cachedInputTokens: ev.usage.cached_input_tokens,
                        reasoningTokens: ev.usage.reasoning_output_tokens,
                    },
                };
                return;
            case "turn.failed":
                yield {
                    type: "error",
                    vendor: this.vendor,
                    message: ev.error.message,
                };
                yield { type: "turn_completed", vendor: this.vendor };
                return;
            case "error":
                yield {
                    type: "error",
                    vendor: this.vendor,
                    message: ev.message,
                    fatal: true,
                };
                return;
            case "item.started":
            case "item.updated":
            case "item.completed":
                yield* this.translateItem(ev.type, ev.item);
                return;
        }
    }

    private *translateItem(
        phase: "item.started" | "item.updated" | "item.completed",
        item: ThreadItem,
    ): Iterable<AgentEvent> {
        switch (item.type) {
            case "agent_message":
                // 只在最终态发文本，避免 updated 阶段重复刷屏
                if (phase === "item.completed") {
                    yield {
                        type: "text",
                        vendor: this.vendor,
                        text: item.text,
                        itemId: item.id,
                    };
                }
                return;
            case "reasoning":
                if (phase === "item.completed") {
                    yield {
                        type: "thinking",
                        vendor: this.vendor,
                        text: item.text,
                        itemId: item.id,
                    };
                }
                return;
            case "command_execution": {
                const status = toToolStatus(item.status);
                yield {
                    type: "tool_use",
                    vendor: this.vendor,
                    id: item.id,
                    name: "shell",
                    input: { command: item.command },
                    status,
                };
                if (status !== "started") {
                    yield {
                        type: "tool_result",
                        vendor: this.vendor,
                        toolUseId: item.id,
                        output: item.aggregated_output,
                        isError: status === "failed" || (item.exit_code ?? 0) !== 0,
                    };
                }
                return;
            }
            case "file_change": {
                // file_change 只在终态才有 status；started/updated 阶段同样上抛进度
                const status: ToolCallStatus =
                    item.status === "failed" ? "failed" : phase === "item.completed" ? "completed" : "started";
                yield {
                    type: "tool_use",
                    vendor: this.vendor,
                    id: item.id,
                    name: "file_change",
                    input: { changes: item.changes },
                    status,
                };
                return;
            }
            case "mcp_tool_call": {
                const status = toToolStatus(item.status);
                yield {
                    type: "tool_use",
                    vendor: this.vendor,
                    id: item.id,
                    name: `mcp:${item.server}/${item.tool}`,
                    input: item.arguments,
                    status,
                };
                if (status === "completed" && item.result) {
                    yield {
                        type: "tool_result",
                        vendor: this.vendor,
                        toolUseId: item.id,
                        output: item.result,
                    };
                } else if (status === "failed" && item.error) {
                    yield {
                        type: "tool_result",
                        vendor: this.vendor,
                        toolUseId: item.id,
                        output: item.error.message,
                        isError: true,
                    };
                }
                return;
            }
            case "web_search":
                yield {
                    type: "tool_use",
                    vendor: this.vendor,
                    id: item.id,
                    name: "web_search",
                    input: { query: item.query },
                    status: phase === "item.completed" ? "completed" : "started",
                };
                return;
            case "todo_list":
                // 每次更新都推送，让上层能看到 todo 演进。
                // Codex 只有 boolean，映射到统一三态的 pending/completed。
                yield {
                    type: "todo",
                    vendor: this.vendor,
                    items: item.items.map((t) => ({
                        text: t.text,
                        status: t.completed ? "completed" : "pending",
                    })),
                };
                return;
            case "error":
                yield {
                    type: "error",
                    vendor: this.vendor,
                    message: item.message,
                };
                return;
        }
    }
}
