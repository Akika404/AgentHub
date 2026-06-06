import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { LlmOrchestratorPlanner } from '../run/orchestrator-planner.js'
import { makeDebugLogger } from './test-helpers.js'

const req = {
    group: {
        id: 'g1',
        orchestratorProviderId: 'p1',
        orchestratorModel: 'm1',
        orchestratorVendor: 'codex',
        workspaceDir: '/tmp/group-g1',
        projectGoal: '要做一个计算器'
    },
    userId: 'u1',
    userText: '你们好，打个招呼',
    routeKind: 'orchestrate',
    mentionedAgentIds: [],
    context: {
        projectGoal: '要做一个计算器',
        blackboardSummary: '(blackboard empty)',
        recentUserIntents: ['你们好，打个招呼'],
        memberStatus: [
            {
                agentId: 'a1',
                name: '前端工程师',
                roleInGroup: null,
                capabilitySummary: '负责界面实现、交互细节和前端工程质量。'
            },
            {
                agentId: 'a2',
                name: '产品经理',
                roleInGroup: null,
                capabilitySummary: '负责需求梳理、MVP 范围判断和设计合理性评审。'
            }
        ],
        activeTaskGraph: []
    }
} as const

function makePlanner(): LlmOrchestratorPlanner {
    return new LlmOrchestratorPlanner(
        {} as never,
        {} as never,
        {} as never,
        makeDebugLogger() as never
    )
}

describe('LlmOrchestratorPlanner', () => {
    test('includes capability summaries in the member list prompt', () => {
        const planner = makePlanner()
        const prompt = (
            planner as unknown as {
                buildPrompt(req: unknown): string
            }
        ).buildPrompt(req)

        assert.match(prompt, /成员（agentId \| 名称 \| 群角色 \| 能力摘要）：/)
        assert.match(prompt, /a1 \| 前端工程师 \| \(未设定\) \| 负责界面实现、交互细节和前端工程质量。/)
        assert.match(prompt, /a2 \| 产品经理 \| \(未设定\) \| 负责需求梳理、MVP 范围判断和设计合理性评审。/)
    })

    test('accepts empty tasks with a note as a non-task reply', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                    memberTurns?: unknown[]
                } | null
            }
        ).parsePlanObject({ tasks: [], note: '你好，欢迎来到计算器项目群。' }, req)

        assert.deepEqual(parsed, {
            tasks: [],
            note: '你好，欢迎来到计算器项目群。'
        })
    })

    test('rejects orchestrator-drafted memberMessages', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [],
                note: '欢迎，大家先简单认识一下。',
                memberMessages: [
                    { agentId: 'a1', text: '你好，我是前端工程师，负责界面和交互实现。' },
                    { agentId: 'a2', text: '你好，我是产品经理，负责梳理需求和优先级。' }
                ]
            },
            req
        )

        assert.equal(parsed, null)
    })

    test('accepts memberTurns for lightweight member replies', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                    memberTurns?: unknown[]
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [],
                note: '我会让产品经理本人给一个判断。',
                memberTurns: [
                    {
                        agentId: 'a2',
                        instruction: '从产品经理视角判断当前设计是否合理，并给出一句简短建议。'
                    }
                ]
            },
            {
                ...req,
                userText: '这里设计的是不是不太合理？',
                context: {
                    ...req.context,
                    recentUserIntents: ['这里设计的是不是不太合理？']
                }
            }
        )

        assert.deepEqual(parsed, {
            tasks: [],
            note: '我会让产品经理本人给一个判断。',
            memberTurns: [
                {
                    agentId: 'a2',
                    instruction: '从产品经理视角判断当前设计是否合理，并给出一句简短建议。'
                }
            ]
        })
    })

    test('accepts a real task for deliverable work', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                    memberTurns?: unknown[]
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [
                    {
                        key: 't1',
                        name: '编写需求说明',
                        agentId: 'a2',
                        deps: [],
                        objective: '编写一份计算器需求说明文档。'
                    }
                ],
                note: '我会让产品经理产出需求说明。'
            },
            req
        )

        assert.deepEqual(parsed, {
            tasks: [
                {
                    key: 't1',
                    name: '编写需求说明',
                    agentId: 'a2',
                    deps: [],
                    objective: '编写一份计算器需求说明文档。'
                }
            ],
            note: '我会让产品经理产出需求说明。'
        })
    })

    test('rejects empty tasks without a note', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): { tasks: unknown[]; note?: string } | null
            }
        ).parsePlanObject({ tasks: [] }, req)

        assert.equal(parsed, null)
    })

    test('rejects non-empty tasks that do not target a valid member', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): { tasks: unknown[]; note?: string } | null
            }
        ).parsePlanObject(
            {
                tasks: [
                    {
                        key: 't1',
                        name: '打招呼',
                        agentId: 'ghost',
                        deps: [],
                        objective: '打招呼'
                    }
                ],
                note: '安排一下。'
            },
            req
        )

        assert.equal(parsed, null)
    })

    test('rejects plans that mix tasks and memberTurns', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                    memberTurns?: unknown[]
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [
                    {
                        key: 't1',
                        name: '编写需求说明',
                        agentId: 'a2',
                        deps: [],
                        objective: '编写一份计算器需求说明文档。'
                    }
                ],
                memberTurns: [{ agentId: 'a1', instruction: '打个招呼。' }]
            },
            req
        )

        assert.equal(parsed, null)
    })

    test('rejects memberTurns that target an invalid member', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                    memberTurns?: unknown[]
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [],
                note: '请大家说一句。',
                memberTurns: [{ agentId: 'ghost', instruction: '打个招呼。' }]
            },
            req
        )

        assert.equal(parsed, null)
    })

    test('rejects memberMessages even if they target a valid member', () => {
        const planner = makePlanner()
        const parsed = (
            planner as unknown as {
                parsePlanObject(obj: unknown, req: unknown): {
                    tasks: unknown[]
                    note?: string
                } | null
            }
        ).parsePlanObject(
            {
                tasks: [],
                note: '欢迎，大家先简单认识一下。',
                memberMessages: [{ agentId: 'a1', text: '你好。' }]
            },
            req
        )

        assert.equal(parsed, null)
    })
})
