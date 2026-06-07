import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { OrchestratorService, type TaskOutcome } from './orchestrator.service.js'
import type {
    OrchestratorFinalReviewRequest,
    OrchestratorFinalReviewResult
} from './orchestrator-final-reviewer.js'
import type { GroupChat } from '../entities/group-chat.entity.js'

describe('OrchestratorService report', () => {
    it('uses final reviewer even when outcomes are not all done', async () => {
        const outcomes: TaskOutcome[] = [
            {
                name: '前端开发实现',
                summary: '构建失败，缺少依赖',
                success: false,
                status: 'failed'
            }
        ]
        const harness = createHarness({
            complete: false,
            summary: '大模型确认：前端实现失败，当前还不能视为完成。',
            completedItems: [],
            gaps: ['前端构建失败'],
            followUpInstruction: '修复依赖并重新构建'
        })

        const result = await harness.service.report(
            group(),
            'user-1',
            'run-1',
            outcomes,
            {
                originalUserText: '实现时区计算器',
                reviewFinal: false
            }
        )

        assert.equal(harness.reviewCalls.length, 1)
        assert.equal(harness.reviewCalls[0].originalUserText, '实现时区计算器')
        assert.deepEqual(harness.reviewCalls[0].outcomes, outcomes)
        assert.equal(result.text, '大模型确认：前端实现失败，当前还不能视为完成。')
        assert.equal(result.shouldContinue, false)
        assert.deepEqual(harness.messages, [
            {
                groupId: 'group-1',
                userId: 'user-1',
                role: 'orchestrator',
                text: '大模型确认：前端实现失败，当前还不能视为完成。'
            }
        ])
    })

    it('falls back to the template only when final reviewer fails', async () => {
        const outcomes: TaskOutcome[] = [
            {
                name: '产品需求梳理',
                summary: '已输出 PRD',
                success: true,
                status: 'done'
            }
        ]
        const harness = createHarness(new Error('review unavailable'))

        const result = await harness.service.report(group(), 'user-1', 'run-1', outcomes, {
            originalUserText: '整理时区计算器需求',
            reviewFinal: true
        })

        assert.equal(harness.reviewCalls.length, 1)
        assert.match(result.text, /本轮任务已全部完成/)
        assert.match(result.text, /产品需求梳理：已输出 PRD/)
        assert.equal(result.shouldContinue, false)
        assert.deepEqual(harness.messages, [
            {
                groupId: 'group-1',
                userId: 'user-1',
                role: 'orchestrator',
                text: result.text
            }
        ])
    })

    it('synthesizes a review subject when original user text is missing', async () => {
        const outcomes: TaskOutcome[] = [
            {
                name: '等待用户确认',
                summary: '请选择目标城市',
                success: false,
                status: 'waiting_input',
                question: '请选择目标城市',
                hasQuestionCard: true
            }
        ]
        const harness = createHarness({
            complete: false,
            summary: '大模型确认：当前正在等待你选择目标城市。',
            completedItems: [],
            gaps: ['缺少目标城市'],
            followUpInstruction: null
        })

        const result = await harness.service.report(group(), 'user-1', 'run-1', outcomes)

        assert.equal(harness.reviewCalls.length, 1)
        assert.match(harness.reviewCalls[0].originalUserText, /未携带原始用户需求/)
        assert.match(harness.reviewCalls[0].originalUserText, /等待用户确认/)
        assert.equal(result.text, '大模型确认：当前正在等待你选择目标城市。')
    })
})

function createHarness(reviewResult: OrchestratorFinalReviewResult | Error): {
    service: OrchestratorService
    reviewCalls: OrchestratorFinalReviewRequest[]
    messages: Array<{ groupId: string; userId: string; role: string; text: string }>
} {
    const reviewCalls: OrchestratorFinalReviewRequest[] = []
    const messages: Array<{ groupId: string; userId: string; role: string; text: string }> = []
    const finalReviewer = {
        review: async (req: OrchestratorFinalReviewRequest) => {
            reviewCalls.push(req)
            if (reviewResult instanceof Error) throw reviewResult
            return reviewResult
        }
    }
    const groupMessages = {
        appendText: async (groupId: string, userId: string, role: string, text: string) => {
            messages.push({ groupId, userId, role, text })
        }
    }
    const service = new OrchestratorService(
        {} as never,
        finalReviewer as never,
        {
            save: async () => undefined
        } as never,
        {} as never,
        groupMessages as never,
        {
            publish: async () => undefined
        } as never,
        {
            log: () => undefined
        } as never
    )
    return { service, reviewCalls, messages }
}

function group(): GroupChat {
    return {
        id: 'group-1',
        userId: 'user-1',
        title: '测试群聊',
        status: 'active',
        workspaceDir: '/tmp/agenthub-test',
        orchestratorVendor: 'codex',
        orchestratorModel: 'test-model',
        orchestratorProviderId: 'provider-1',
        orchestratorSessionId: null,
        projectName: '测试项目',
        projectGoal: null,
        projectTechStack: [],
        projectStatus: 'planning',
        createdAt: new Date(0),
        updatedAt: new Date(0)
    }
}
