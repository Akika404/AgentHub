import type { BlackboardTaskNode, BlackboardTaskStatus } from '@agenthub/shared'

/**
 * 纯调度逻辑（无副作用，可单测）。GroupRunExecutor 的 DAG 派发据此决定就绪集与失败降级。
 *
 * 约定：statusById 是 taskId -> 当前状态 的可变映射，调度器在派发过程中持续更新它。
 * 终态：done / failed / blocked；活动态：pending / ready / doing。
 */

const ACTIVE: ReadonlySet<BlackboardTaskStatus> = new Set<BlackboardTaskStatus>([
    'pending',
    'ready'
])

/**
 * 计算"现在可派发"的节点：自身仍是 pending/ready，且全部依赖均已 done。
 * 依赖中有 failed/blocked 的节点不会就绪（应由 markDownstreamBlocked 先行阻塞）。
 */
export function computeReady(
    nodes: BlackboardTaskNode[],
    statusById: Map<string, BlackboardTaskStatus>
): BlackboardTaskNode[] {
    return nodes.filter((n) => {
        const st = statusById.get(n.id)
        if (st === undefined || !ACTIVE.has(st)) return false
        return n.deps.every((d) => statusById.get(d) === 'done')
    })
}

/**
 * 把 failedId 的传递闭包下游（仍处 pending/ready 的）标为 blocked，并就地更新 statusById。
 * 返回本次新阻塞的 taskId 列表（供调用方落库 + 推流）。
 * 互不依赖的任务不受影响 —— 这正是"单点失败不连坐"的核心。
 */
export function markDownstreamBlocked(
    nodes: BlackboardTaskNode[],
    failedId: string,
    statusById: Map<string, BlackboardTaskStatus>
): string[] {
    const dependents = new Map<string, string[]>()
    for (const n of nodes) {
        for (const d of n.deps) {
            const arr = dependents.get(d) ?? []
            arr.push(n.id)
            dependents.set(d, arr)
        }
    }
    const blocked: string[] = []
    const queue: string[] = [failedId]
    while (queue.length > 0) {
        const cur = queue.shift() as string
        for (const childId of dependents.get(cur) ?? []) {
            const st = statusById.get(childId)
            if (st !== undefined && ACTIVE.has(st)) {
                statusById.set(childId, 'blocked')
                blocked.push(childId)
                queue.push(childId)
            }
        }
    }
    return blocked
}

/** 是否还有活动态（pending/ready）节点 —— 用于判断调度是否结束。 */
export function hasPendingWork(
    nodes: BlackboardTaskNode[],
    statusById: Map<string, BlackboardTaskStatus>
): boolean {
    return nodes.some((n) => {
        const st = statusById.get(n.id)
        return st !== undefined && ACTIVE.has(st)
    })
}
