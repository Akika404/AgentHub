import { Injectable } from '@nestjs/common'
import type { GroupRouteKind } from '@agenthub/shared'

/** 用于解析 @ 的群成员最小信息 */
export interface RouterMember {
    agentId: string
    name: string
}

export interface RouteResult {
    routeKind: GroupRouteKind
    /** 命中的成员 Agent id（去重、保序） */
    mentionedAgentIds: string[]
    mentionsOrchestrator: boolean
}

/** Orchestrator 的保留提及关键字（前端 @ 也可用 agentId='orchestrator'） */
const ORCHESTRATOR_TOKENS = ['orchestrator', '编排', '编排器', 'orch']

/**
 * MessageRouter — 纯机械路由：解析 @mentions，决定 routeKind。**不调 LLM、不理解语义。**
 *
 * 路由表：
 *   @单个成员         → direct_single（走 ContinuityResolver 判 A/B/C 后直派）
 *   @A @B（多个成员） → multi（交 Orchestrator 轻量协调，顺序各派一个任务）
 *   @Orchestrator     → orchestrate（强制 Orchestrator 介入生成计划）
 *   无 @              → orchestrate（默认交 Orchestrator 判复杂度后分发）
 */
@Injectable()
export class MessageRouter {
    /**
     * @param text 用户消息原文
     * @param mentions 前端解析好的提及（成员 agentId 或 'orchestrator'）；缺省则从原文解析 @
     * @param members 群成员（用于按名字解析 @）
     */
    route(text: string, mentions: string[] | undefined, members: RouterMember[]): RouteResult {
        const memberIds = new Set(members.map((m) => m.agentId))
        const mentionedAgentIds: string[] = []
        let mentionsOrchestrator = false

        const add = (token: string): void => {
            const t = token.trim()
            if (!t) return
            if (ORCHESTRATOR_TOKENS.includes(t.toLowerCase())) {
                mentionsOrchestrator = true
            } else if (memberIds.has(t) && !mentionedAgentIds.includes(t)) {
                mentionedAgentIds.push(t)
            }
        }

        if (mentions && mentions.length > 0) {
            for (const m of mentions) add(m)
        } else {
            for (const id of this.parseMentionsFromText(text, members)) add(id)
        }

        let routeKind: GroupRouteKind
        if (mentionsOrchestrator) routeKind = 'orchestrate'
        else if (mentionedAgentIds.length === 1) routeKind = 'direct_single'
        else if (mentionedAgentIds.length >= 2) routeKind = 'multi'
        else routeKind = 'orchestrate'

        return { routeKind, mentionedAgentIds, mentionsOrchestrator }
    }

    /** 从原文解析 @：匹配 Orchestrator 关键字或成员名。返回 token（agentId 或 'orchestrator'）。 */
    private parseMentionsFromText(text: string, members: RouterMember[]): string[] {
        const tokens: string[] = []
        const at = /@([^\s@]+)/g
        let match: RegExpExecArray | null
        while ((match = at.exec(text)) !== null) {
            const raw = match[1]
            if (ORCHESTRATOR_TOKENS.some((t) => raw.toLowerCase().startsWith(t))) {
                tokens.push('orchestrator')
                continue
            }
            const member = members.find((m) => raw === m.name || raw.startsWith(m.name))
            if (member) tokens.push(member.agentId)
        }
        return tokens
    }
}
