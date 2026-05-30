import type { AgentAdapter, AgentVendor } from './adapter/index.js'

/**
 * LiveAgent — 内存中的活实例（不持久化）。
 *
 * 是 AgentSession 句柄在某次"激活"期间的运行时镜像：持有真正的 adapter、
 * 并发互斥标志、当前 turn 的中止器，以及用于 LRU 驱逐的最近使用时间。
 */
export interface LiveAgent {
    sessionId: string
    specId: string
    vendor: AgentVendor
    adapter: AgentAdapter
    /** 是否有进行中的 send()；并发对话会被拒为 AGENT_BUSY */
    busy: boolean
    /** 当前 turn 的中止器（客户端断连时 abort） */
    abort: AbortController | null
    /** 最近一次被使用的时间戳（ms），用于 LRU 驱逐与 idle 清扫 */
    lastUsedAt: number
}
