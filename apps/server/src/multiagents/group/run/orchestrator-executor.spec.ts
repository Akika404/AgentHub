import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { GroupChat } from '../entities/group-chat.entity.js'
import {
    LlmOrchestratorExecutor,
    type OrchestratorDecision,
    type DecisionRequest
} from './orchestrator-executor.js'

interface StubRunResult {
    text: string
    success: boolean
    error?: string
    structuredOutput?: unknown
    sessionId?: string | null
}

function createPlanner(result: StubRunResult): LlmOrchestratorExecutor {
    const planner = new LlmOrchestratorExecutor(
        {} as never,
        {} as never,
        {} as never,
        { log: () => undefined } as never
    )
    Object.defineProperty(planner, 'runOrchestrator', {
        value: async () => result
    })
    return planner
}

function planRequest(): DecisionRequest {
    return {
        group: {
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
            projectGoal: null,
            projectTechStack: null,
            projectStatus: 'planning',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z')
        } as GroupChat,
        userId: 'user-1',
        userText: '各位好',
        routeKind: 'orchestrate',
        mentionedAgentIds: [],
        context: {
            projectGoal: null,
            blackboardSummary: '(blackboard empty)',
            pinnedMessages: '',
            recentUserIntents: ['各位好'],
            memberStatus: [],
            activeTaskGraph: []
        }
    }
}

test('LlmOrchestratorPlanner ignores raw SDK text when structured output is available', async () => {
    const note =
        '大家好！欢迎来到 AgentHub。我是 Orchestrator，负责协调大家的工作。请问今天想做什么项目？'
    const json = JSON.stringify({ tasks: [], note })
    const planner = createPlanner({
        text: [json, json, note].join('\n\n'),
        success: true,
        structuredOutput: { tasks: [], note },
        sessionId: 'sdk-session-1'
    })

    const plan: OrchestratorDecision = await planner.decide(planRequest())

    assert.equal(plan.note, note)
    assert.equal(plan.displayText, undefined)
    assert.equal(plan.orchestratorSessionId, 'sdk-session-1')
})
