import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { OrchestratorService } from '../run/orchestrator.service.js'
import { makeDebugLogger } from './test-helpers.js'

describe('OrchestratorService', () => {
    test('writes member greeting messages without creating tasks', async () => {
        let upsertTaskGraphCalled = false
        const appendedTexts: Array<{
            senderRole: string
            text: string
            senderAgentId: string | null
        }> = []
        const taskLists: unknown[] = []
        const published: unknown[] = []

        const service = new OrchestratorService(
            {
                plan: async () => ({
                    tasks: [],
                    note: '欢迎，大家先简单认识一下。',
                    memberMessages: [
                        {
                            agentId: 'a1',
                            text: '你好，我是前端工程师，负责界面和交互实现。'
                        },
                        {
                            agentId: 'a2',
                            text: '你好，我是产品经理，负责梳理需求和优先级。'
                        }
                    ]
                })
            },
            {
                getState: async () => ({
                    artifacts: [],
                    decisions: [],
                    contracts: [],
                    taskGraph: []
                }),
                summarize: async () => '(blackboard empty)',
                upsertTaskGraph: async () => {
                    upsertTaskGraphCalled = true
                    return []
                }
            } as never,
            {
                appendText: async (
                    _groupId: string,
                    _userId: string,
                    senderRole: string,
                    text: string,
                    senderAgentId: string | null = null
                ) => {
                    appendedTexts.push({ senderRole, text, senderAgentId })
                    return {} as never
                },
                appendTaskList: async (...args: unknown[]) => {
                    taskLists.push(args)
                    return {} as never
                }
            } as never,
            {
                publish: async (_runId: string, event: unknown) => {
                    published.push(event)
                }
            } as never,
            makeDebugLogger() as never
        )

        const result = await service.plan({
            group: {
                id: 'g1',
                projectGoal: '要做一个计算器'
            } as never,
            userId: 'u1',
            runId: 'r1',
            userText: '你们好，打个招呼',
            routeKind: 'orchestrate',
            mentionedAgentIds: [],
            members: [
                {
                    member: { roleInGroup: null } as never,
                    agent: { id: 'a1', name: '前端工程师' } as never
                },
                {
                    member: { roleInGroup: null } as never,
                    agent: { id: 'a2', name: '产品经理' } as never
                }
            ]
        })

        assert.deepEqual(result.nodes, [])
        assert.equal(upsertTaskGraphCalled, false)
        assert.deepEqual(taskLists, [])
        assert.deepEqual(appendedTexts, [
            {
                senderRole: 'orchestrator',
                text: '欢迎，大家先简单认识一下。',
                senderAgentId: null
            },
            {
                senderRole: 'agent',
                text: '你好，我是前端工程师，负责界面和交互实现。',
                senderAgentId: 'a1'
            },
            {
                senderRole: 'agent',
                text: '你好，我是产品经理，负责梳理需求和优先级。',
                senderAgentId: 'a2'
            }
        ])
        assert.deepEqual(published, [
            {
                type: 'orchestrator_report',
                runId: 'r1',
                text: '欢迎，大家先简单认识一下。'
            }
        ])
    })
})
