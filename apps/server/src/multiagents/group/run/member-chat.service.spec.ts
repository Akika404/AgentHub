import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AgentEvent } from '../../adapter/index.js'
import { normalizeMemberChatStreamEvent } from './member-chat.service.js'

describe('normalizeMemberChatStreamEvent', () => {
    it('prefers structured output text for completed lightweight member replies', () => {
        const event: AgentEvent = {
            type: 'turn_completed',
            vendor: 'claude',
            finalText: '已经按要求使用 StructuredOutput 工具完成了回复。',
            structuredOutput: { text: '大家好！我是这个项目的产品经理。' }
        }

        assert.deepEqual(normalizeMemberChatStreamEvent(event), {
            ...event,
            finalText: '大家好！我是这个项目的产品经理。'
        })
    })

    it('extracts text from JSON-string text events', () => {
        const event: AgentEvent = {
            type: 'text',
            vendor: 'codex',
            text: '{"text":"大家好，我是前端工程师。"}'
        }

        assert.deepEqual(normalizeMemberChatStreamEvent(event), {
            ...event,
            text: '大家好，我是前端工程师。'
        })
    })

    it('keeps plain text when no structured text is present', () => {
        const event: AgentEvent = {
            type: 'turn_completed',
            vendor: 'claude',
            finalText: '普通回复'
        }

        assert.deepEqual(normalizeMemberChatStreamEvent(event), event)
    })

    it('normalizes done events when the adapter only exposes structured output at the end', () => {
        const event: AgentEvent = {
            type: 'done',
            vendor: 'codex',
            success: true,
            finalText: '{"text":"工具包装文本"}',
            structuredOutput: { text: '真正的最终回复' }
        }

        assert.deepEqual(normalizeMemberChatStreamEvent(event), {
            ...event,
            finalText: '真正的最终回复'
        })
    })
})
