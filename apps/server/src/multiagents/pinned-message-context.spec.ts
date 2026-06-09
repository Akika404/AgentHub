import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { AgentSession } from './entities/agent-session.entity.js'
import { AgentMessage } from './entities/agent-message.entity.js'
import { AgentRuntimeService } from './runtime/agent-runtime.service.js'
import { AgentMessageHistoryService } from './messages/agent-message-history.service.js'
import { GroupMessage } from './group/entities/group-message.entity.js'
import { GroupMessageService } from './group/group-message.service.js'
import { ContextAssembler } from './group/context/context-assembler.service.js'
import { LlmOrchestratorExecutor, type DecisionRequest } from './group/run/orchestrator-executor.js'
import { MemberChatService } from './group/run/member-chat.service.js'
import type { GroupChat } from './group/entities/group-chat.entity.js'

const NOW = new Date('2026-01-01T00:00:00.000Z')

function matchesWhere<T extends Record<string, unknown>>(
    row: T,
    where: Record<string, unknown>
): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value)
}

function agentMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
    return {
        id: 'message-1',
        userId: 'user-1',
        agentId: 'agent-1',
        sessionId: 'session-1',
        role: 'user',
        text: '请始终记住这个约束',
        replyTo: null,
        pinned: false,
        createdAt: NOW,
        ...overrides
    } as AgentMessage
}

function groupMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
    return {
        id: 'group-message-1',
        userId: 'user-1',
        groupChatId: 'group-1',
        kind: 'text',
        senderRole: 'user',
        senderAgentId: null,
        text: '全局约束：只改前端',
        payload: null,
        replyTo: null,
        pinned: false,
        createdAt: NOW,
        ...overrides
    } as GroupMessage
}

function group(): GroupChat {
    return {
        id: 'group-1',
        userId: 'user-1',
        title: 'Test Group',
        status: 'active',
        isPinned: false,
        archivedAt: null,
        workspaceDir: '/tmp/agenthub-test',
        orchestratorVendor: 'claude',
        orchestratorModel: 'test-model',
        orchestratorProviderId: 'provider-1',
        orchestratorSessionId: null,
        projectName: 'Test Project',
        projectGoal: 'Build a tool',
        projectTechStack: null,
        projectStatus: 'planning',
        createdAt: NOW,
        updatedAt: NOW
    } as GroupChat
}

test('AgentMessageHistoryService persists message pin and renders single-chat context', async () => {
    const rows = [agentMessage()]
    const messageRepo = {
        find: async ({ where }: { where: Record<string, unknown> }) =>
            rows.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where)),
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
            rows.find((row) => matchesWhere(row as unknown as Record<string, unknown>, where)) ??
            null,
        create: (value: unknown) => value,
        save: async (value: AgentMessage) => value
    }
    const service = new AgentMessageHistoryService(
        messageRepo as never,
        { find: async () => [] } as never
    )

    const view = await service.updateChatMessage('user-1', 'session-1', 'message-1', {
        pinned: true
    })
    const context = await service.pinnedContext('user-1', 'session-1')

    assert.equal(view.pinned, true)
    assert.equal(rows[0].pinned, true)
    assert.equal(context.includes('# Pinned messages (会话内全局上下文)'), true)
    assert.equal(context.includes('请始终记住这个约束'), true)
})

test('GroupMessageService persists pin and renders card summaries for group context', async () => {
    const rows = [
        groupMessage({
            kind: 'task-list',
            text: null,
            payload: {
                heading: '任务计划',
                tasks: [{ id: 'task-1', title: '实现 Pin 上下文', status: 'done' }]
            }
        })
    ]
    const messageRepo = {
        find: async ({ where }: { where: Record<string, unknown> }) =>
            rows.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where)),
        findOne: async ({ where }: { where: Record<string, unknown> }) =>
            rows.find((row) => matchesWhere(row as unknown as Record<string, unknown>, where)) ??
            null,
        create: (value: unknown) => value,
        save: async (value: GroupMessage) => value
    }
    const service = new GroupMessageService(
        messageRepo as never,
        { find: async () => [] } as never
    )

    const view = await service.updateMessage('group-1', 'group-message-1', { pinned: true })
    const context = await service.pinnedContext('group-1')

    assert.equal(view.pinned, true)
    assert.equal(rows[0].pinned, true)
    assert.equal(context.includes('# Pinned messages (群聊内全局上下文)'), true)
    assert.equal(context.includes('任务计划'), true)
    assert.equal(context.includes('实现 Pin 上下文 [done]'), true)
})

test('single-chat SDK prompt prepends pinned context before quoted prompt', async () => {
    const runtime = Object.create(AgentRuntimeService.prototype) as unknown as {
        messages: {
            pinnedContext(userId: string, sessionId: string): Promise<string>
            getMessageText(userId: string, sessionId: string, messageId: string): Promise<string>
        }
        buildSdkPrompt(
            session: AgentSession,
            prompt: string,
            replyTo: { messageId: string; senderName: string; excerpt: string }
        ): Promise<string>
    }
    runtime.messages = {
        pinnedContext: async () => '# Pinned messages (会话内全局上下文)\n- 固定约束',
        getMessageText: async () => '被引用消息原文'
    }

    const prompt = await runtime.buildSdkPrompt(
        { id: 'session-1', userId: 'user-1' } as AgentSession,
        '继续执行',
        { messageId: 'quoted-1', senderName: '用户', excerpt: 'fallback' }
    )

    assert.equal(prompt.startsWith('# Pinned messages'), true)
    assert.equal(prompt.includes('固定约束'), true)
    assert.equal(prompt.includes('> [引用 用户]'), true)
    assert.equal(prompt.trim().endsWith('继续执行'), true)
})

test('group orchestrator, task context, and lightweight member chat include pinned context', async () => {
    const pinned = '# Pinned messages (群聊内全局上下文)\n- 全局约束：只改前端'
    const planner = new LlmOrchestratorExecutor(
        {} as never,
        {} as never,
        {} as never,
        { log: () => undefined } as never
    ) as unknown as {
        buildPrompt(req: DecisionRequest): string
    }
    const orchestratorPrompt = planner.buildPrompt({
        group: group(),
        userId: 'user-1',
        userText: '开始',
        routeKind: 'orchestrate',
        mentionedAgentIds: [],
        context: {
            projectGoal: 'Build a tool',
            blackboardSummary: '(empty)',
            pinnedMessages: pinned,
            recentUserIntents: ['开始'],
            memberStatus: [],
            activeTaskGraph: []
        }
    })
    assert.equal(orchestratorPrompt.includes('Pin 消息上下文'), true)
    assert.equal(orchestratorPrompt.includes('全局约束：只改前端'), true)

    const assembler = new ContextAssembler(
        {
            getState: async () => ({ artifacts: [], contracts: [], decisions: [] })
        } as never,
        { retrieve: async () => [], markStale: async () => undefined } as never,
        { pinnedContext: async () => pinned } as never,
        {
            blackboardSnapshot: (value: unknown) => value,
            compactText: (value: string) => value,
            log: () => undefined
        } as never
    )
    const assembled = await assembler.assemble({
        groupId: 'group-1',
        agentId: 'agent-1',
        task: { objective: '实现功能', mode: 'new_task' },
        scope: { project: 'group-1', module: null }
    })
    assert.equal(assembled.trace.pinnedMessages, true)
    assert.equal(assembled.prompt.includes('全局约束：只改前端'), true)

    const memberChat = Object.create(MemberChatService.prototype) as unknown as {
        buildPrompt(instruction: string, pinnedContext: string): string
    }
    const memberPrompt = memberChat.buildPrompt('说一句建议', pinned)
    assert.equal(memberPrompt.startsWith('# Pinned messages'), true)
    assert.equal(memberPrompt.includes('全局约束：只改前端'), true)
    assert.equal(memberPrompt.includes('说一句建议'), true)
})
