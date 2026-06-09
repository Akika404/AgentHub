import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ChatRequest, ChatResponse } from '../../../chat-client/index.js'
import type { GroupChat } from '../entities/group-chat.entity.js'
import { LlmOrchestratorHandoffReviewer } from './orchestrator-handoff-reviewer.js'

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
        orchestratorModel: 'claude-test',
        orchestratorProviderId: 'provider-1',
        orchestratorSessionId: 'planner-session-1',
        projectName: 'Test Project',
        projectGoal: 'Build a small app',
        projectTechStack: null,
        projectStatus: 'development',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z')
    } as GroupChat
}

test('LlmOrchestratorHandoffReviewer uses stateless ChatClient with enough context', async () => {
    const capturedRequests: ChatRequest[] = []
    const reviewer = new LlmOrchestratorHandoffReviewer(
        {
            resolveRuntimeConfig: async () => ({
                type: 'anthropic',
                apiKey: 'sk-test',
                baseUrl: 'https://api.anthropic.com'
            })
        } as never,
        {
            chat: async (request: ChatRequest): Promise<ChatResponse> => {
                capturedRequests.push(request)
                return {
                    id: 'msg-1',
                    model: request.model,
                    providerType: request.providerType,
                    text: JSON.stringify({
                        completed: false,
                        awaitingUserInput: true,
                        question: '请选择目标平台。',
                        reason: '成员输出要求用户选择平台后才能继续。'
                    })
                }
            }
        },
        { summarize: async () => '黑板：已有需求草案。' } as never,
        { log: () => undefined } as never
    )

    const result = await reviewer.review({
        group: group(),
        userId: 'user-1',
        runId: 'run-1',
        originalUserText: '做一个网页版工具',
        task: {
            id: 'task-1',
            name: '确认产品形态',
            objective: '确认目标平台和范围',
            agentId: 'agent-1',
            agentName: '产品经理',
            roleInGroup: '产品',
            capabilitySummary: '擅长需求澄清、范围定义和用户问题收敛。',
            summary: '我需要你先确认：网页版还是桌面版？'
        },
        downstreamTasks: [
            {
                id: 'task-2',
                name: '实现前端',
                objective: '根据确认的平台实现 UI',
                agentId: 'agent-2',
                deps: ['task-1']
            }
        ]
    })

    assert.equal(result.awaitingUserInput, true)
    assert.equal(result.completed, false)
    assert.equal(result.question, '请选择目标平台。')
    const captured = capturedRequests[0]
    assert.ok(captured)
    assert.equal(captured.providerType, 'anthropic')
    assert.equal(captured.model, 'claude-test')
    assert.equal(captured.systemPrompt?.includes('无状态的一次性判断器'), true)
    assert.equal(captured.messages[0]?.content.includes('做一个网页版工具'), true)
    assert.equal(captured.messages[0]?.content.includes('roleInGroup=产品'), true)
    assert.equal(captured.messages[0]?.content.includes('需求澄清、范围定义'), true)
    assert.equal(captured.messages[0]?.content.includes('我需要你先确认'), true)
    assert.equal(captured.messages[0]?.content.includes('实现前端'), true)
    assert.equal(captured.messages[0]?.content.includes('黑板：已有需求草案。'), true)
})
