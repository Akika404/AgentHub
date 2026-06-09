import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { extractAnthropicText, resolveOpenAiReasoningEffort } from './chat-client.js'

test('resolveOpenAiReasoningEffort disables reasoning for models that support none', () => {
    assert.equal(resolveOpenAiReasoningEffort('gpt-5.1', 'none'), 'none')
    assert.equal(resolveOpenAiReasoningEffort('gpt-5.1-mini', 'none'), 'none')
})

test('resolveOpenAiReasoningEffort avoids unsupported none on older reasoning models', () => {
    assert.equal(resolveOpenAiReasoningEffort('gpt-5', 'none'), 'minimal')
    assert.equal(resolveOpenAiReasoningEffort('o3-mini', 'none'), 'minimal')
    assert.equal(resolveOpenAiReasoningEffort('gpt-4o', 'none'), undefined)
})

test('resolveOpenAiReasoningEffort keeps explicit non-default effort', () => {
    assert.equal(resolveOpenAiReasoningEffort('gpt-5.1', 'low'), 'low')
})

test('extractAnthropicText joins visible text blocks only', () => {
    const text = extractAnthropicText([
        { type: 'text', text: 'hello', citations: [] },
        { type: 'thinking', thinking: 'hidden', signature: 'sig' },
        { type: 'text', text: 'world', citations: [] }
    ])

    assert.equal(text, 'hello\nworld')
})
