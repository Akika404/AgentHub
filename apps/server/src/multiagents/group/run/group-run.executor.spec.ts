import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BlackboardTaskNode, GroupRouteKind } from '@agenthub/shared'
import { GroupRunExecutor } from './group-run.executor.js'
import type { OrchestratorReportResult, TaskOutcome } from './orchestrator.service.js'

interface PlanResult {
    nodes: BlackboardTaskNode[]
    memberTurns: Array<{ agentId: string; instruction: string }>
}

interface Harness {
    executor: {
        runOrchestrated(
            group: Record<string, unknown>,
            userId: string,
            runId: string,
            routeKind: GroupRouteKind,
            mentionedAgentIds: string[],
            userText: string,
            members: Array<{ member: Record<string, unknown>; agent: Record<string, unknown> }>,
            byAgent: Map<
                string,
                { member: Record<string, unknown>; agent: Record<string, unknown> }
            >,
            signal: AbortSignal
        ): Promise<{ success: boolean; suspended: boolean; outcomes?: TaskOutcome[] }>
    }
    planCalls: Record<string, unknown>[]
    dispatchCalls: Record<string, unknown>[]
    reportCalls: TaskOutcome[][]
    reportOptions: Record<string, unknown>[]
}

describe('GroupRunExecutor orchestration continuation', () => {
    it('continues with downstream member tasks after an upstream planning task completes', async () => {
        const pmTask = task('pm-task', 'pm', '时区计算器需求梳理')
        const frontendTask = task('fe-task', 'frontend', '实现时区计算器网页版')
        const harness = createHarness([
            { nodes: [pmTask], memberTurns: [] },
            { nodes: [frontendTask], memberTurns: [] },
            { nodes: [], memberTurns: [] }
        ])
        const { group, userId, runId, members, byAgent } = fixtures()

        const result = await harness.executor.runOrchestrated(
            group,
            userId,
            runId,
            'orchestrate',
            [],
            '做一个时区计算器',
            members,
            byAgent,
            new AbortController().signal
        )

        assert.equal(result.success, true)
        assert.equal(result.suspended, false)
        assert.deepEqual(
            harness.dispatchCalls.map((call) => (call.agent as { id: string }).id),
            ['pm', 'frontend']
        )
        assert.equal(harness.planCalls.length, 3)
        assert.equal(harness.planCalls[1].routeKind, 'orchestrate')
        assert.equal(harness.planCalls[1].suppressNoopMessage, true)
        assert.match(String(harness.planCalls[1].userText), /内部续编排检查/)
        assert.match(String(harness.planCalls[1].userText), /产品经理完成：时区计算器需求梳理/)
        assert.equal(harness.reportCalls.length, 1)
        assert.deepEqual(
            harness.reportCalls[0].map((outcome) => outcome.name),
            ['时区计算器需求梳理', '实现时区计算器网页版']
        )
    })

    it('does not run continuation checks for a pure orchestrator noop reply', async () => {
        const harness = createHarness([{ nodes: [], memberTurns: [] }])
        const { group, userId, runId, members, byAgent } = fixtures()

        const result = await harness.executor.runOrchestrated(
            group,
            userId,
            runId,
            'orchestrate',
            [],
            '你好',
            members,
            byAgent,
            new AbortController().signal
        )

        assert.equal(result.success, true)
        assert.equal(harness.planCalls.length, 1)
        assert.equal(harness.dispatchCalls.length, 0)
        assert.equal(harness.reportCalls.length, 0)
    })

    it('uses final review gaps to continue dispatch before reporting completion', async () => {
        const firstTask = task('fe-task-1', 'frontend', '实现时区计算器网页版')
        const fixTask = task('fe-task-2', 'frontend', '补齐夏令时校验')
        const harness = createHarness(
            [
                { nodes: [firstTask], memberTurns: [] },
                { nodes: [], memberTurns: [] },
                { nodes: [fixTask], memberTurns: [] },
                { nodes: [], memberTurns: [] }
            ],
            [
                {
                    text: '',
                    shouldContinue: true,
                    followUpInstruction: '补齐夏令时校验并确认英美城市转换正确',
                    review: {
                        complete: false,
                        summary: '目前缺少夏令时校验。',
                        completedItems: ['已实现基础页面'],
                        gaps: ['缺少夏令时校验'],
                        followUpInstruction: '补齐夏令时校验并确认英美城市转换正确'
                    }
                },
                {
                    text: '已完成并验收通过。',
                    shouldContinue: false,
                    review: {
                        complete: true,
                        summary: '已完成并验收通过。',
                        completedItems: ['基础页面', '夏令时校验'],
                        gaps: [],
                        followUpInstruction: null
                    }
                }
            ]
        )
        const { group, userId, runId, members, byAgent } = fixtures()

        const result = await harness.executor.runOrchestrated(
            group,
            userId,
            runId,
            'orchestrate',
            [],
            '做一个支持夏令时的时区计算器',
            members,
            byAgent,
            new AbortController().signal
        )

        assert.equal(result.success, true)
        assert.deepEqual(
            harness.dispatchCalls.map((call) => String(call.taskName)),
            ['实现时区计算器网页版', '补齐夏令时校验']
        )
        assert.equal(harness.reportCalls.length, 2)
        assert.equal(harness.reportOptions[0].reviewFinal, true)
        assert.equal(harness.reportOptions[0].emitIncompleteReview, false)
        assert.match(String(harness.planCalls[2].userText), /最终验收未通过/)
        assert.match(String(harness.planCalls[2].userText), /补齐夏令时校验/)
    })
})

function createHarness(
    plans: PlanResult[],
    reportResults: OrchestratorReportResult[] = []
): Harness {
    const planCalls: Record<string, unknown>[] = []
    const dispatchCalls: Record<string, unknown>[] = []
    const reportCalls: TaskOutcome[][] = []
    const reportOptions: Record<string, unknown>[] = []
    let planIndex = 0
    let reportIndex = 0

    const orchestrator = {
        plan: async (params: Record<string, unknown>) => {
            planCalls.push(params)
            return plans[planIndex++] ?? { nodes: [], memberTurns: [] }
        },
        report: async (
            _group: Record<string, unknown>,
            _userId: string,
            _runId: string,
            outcomes: TaskOutcome[],
            options: Record<string, unknown> = {}
        ) => {
            reportCalls.push(outcomes)
            reportOptions.push(options)
            return reportResults[reportIndex++] ?? { text: 'report', shouldContinue: false }
        }
    }
    const dispatch = {
        dispatch: async (params: Record<string, unknown>) => {
            dispatchCalls.push(params)
            const agent = params.agent as { id: string; name: string }
            return {
                success: true,
                summary: `${agent.name}完成：${String(params.taskName)}`
            }
        }
    }
    const executor = new GroupRunExecutor(
        {} as never,
        {} as never,
        {} as never,
        {
            resolve: async () => ({
                case: 'C',
                targetArtifactPaths: [],
                hotContext: null,
                needsOrchestratorJudgement: false
            })
        } as never,
        orchestrator as never,
        dispatch as never,
        {} as never,
        {
            setTaskStatus: async () => undefined
        } as never,
        {
            updateTaskListTaskStatus: async () => 1,
            appendSystem: async () => undefined
        } as never,
        {
            publish: async () => undefined
        } as never,
        {
            get: (key: string, fallback: string) =>
                key === 'GROUP_MAX_ORCHESTRATION_STAGES' ? '4' : fallback
        } as never,
        {
            log: () => undefined
        } as never
    )

    return {
        executor: executor as unknown as Harness['executor'],
        planCalls,
        dispatchCalls,
        reportCalls,
        reportOptions
    }
}

function fixtures(): {
    group: Record<string, unknown>
    userId: string
    runId: string
    members: Array<{ member: Record<string, unknown>; agent: Record<string, unknown> }>
    byAgent: Map<string, { member: Record<string, unknown>; agent: Record<string, unknown> }>
} {
    const userId = 'user-1'
    const runId = 'run-1'
    const group = {
        id: 'group-1',
        userId,
        workspaceDir: '/tmp/agenthub-test'
    }
    const members = [member('pm', '产品经理', '产品'), member('frontend', '前端工程师', '前端')]
    return {
        group,
        userId,
        runId,
        members,
        byAgent: new Map(members.map((pair) => [pair.agent.id as string, pair]))
    }
}

function member(
    agentId: string,
    name: string,
    roleInGroup: string
): { member: Record<string, unknown>; agent: Record<string, unknown> } {
    return {
        member: {
            agentId,
            roleInGroup,
            agentSessionId: null
        },
        agent: {
            id: agentId,
            name,
            vendor: 'codex',
            model: 'test-model',
            capabilitySummary: roleInGroup
        }
    }
}

function task(id: string, agentId: string, name: string): BlackboardTaskNode {
    return {
        id,
        name,
        agentId,
        deps: [],
        status: 'ready',
        objective: name
    }
}
