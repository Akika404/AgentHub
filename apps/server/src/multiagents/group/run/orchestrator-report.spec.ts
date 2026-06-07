import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buildOrchestratorReportText, type TaskOutcome } from './orchestrator.service.js'

function outcome(overrides: Partial<TaskOutcome>): TaskOutcome {
    return {
        name: '需求澄清',
        summary: '请确认产品形态、时区范围、夏令时处理等 4 个问题',
        success: false,
        status: 'waiting_input',
        ...overrides
    }
}

test('skips duplicate orchestrator report for interactive question-card waiting state', () => {
    const text = buildOrchestratorReportText([
        outcome({
            question: '请确认产品形态、时区范围、夏令时处理等 4 个问题',
            hasQuestionCard: true
        })
    ])

    assert.equal(text, null)
})

test('keeps waiting report when no interactive question card was shown', () => {
    const text = buildOrchestratorReportText([
        outcome({ question: '请直接回复你的确认结果' })
    ])

    assert.ok(text)
    assert.match(text, /1 等待回复/)
    assert.match(text, /直接回复即可让其继续/)
})
