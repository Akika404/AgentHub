import { Injectable } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { ProviderType } from '../platform-provider/entities/platform-provider.entity.js'

export const CHAT_CLIENT = Symbol('CHAT_CLIENT')

export type ChatRole = 'user' | 'assistant'
export type ChatReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ChatMessage {
    role: ChatRole
    content: string
}

export interface ChatRequest {
    providerType: ProviderType
    model: string
    apiKey: string
    baseUrl?: string
    systemPrompt?: string
    messages: ChatMessage[]
    maxTokens?: number
    temperature?: number
    reasoningEffort?: ChatReasoningEffort
    signal?: AbortSignal
}

export interface ChatUsage {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    cachedInputTokens?: number
    reasoningTokens?: number
}

export interface ChatResponse {
    id?: string
    model: string
    providerType: ProviderType
    text: string
    usage?: ChatUsage
}

export interface ChatClient {
    chat(request: ChatRequest): Promise<ChatResponse>
}

const DEFAULT_MAX_TOKENS = 4096

@Injectable()
export class DefaultChatClient implements ChatClient {
    async chat(request: ChatRequest): Promise<ChatResponse> {
        switch (request.providerType) {
            case 'openai-responses':
                return this.chatOpenAiResponses(request)
            case 'openai-chat-completions':
                return this.chatOpenAiCompletions(request)
            case 'anthropic':
                return this.chatAnthropic(request)
        }
    }

    private async chatOpenAiResponses(request: ChatRequest): Promise<ChatResponse> {
        const client = new OpenAI(openAiClientOptions(request))
        const reasoningEffort = resolveOpenAiReasoningEffort(
            request.model,
            request.reasoningEffort ?? 'none'
        )
        const response = await client.responses.create(
            {
                model: request.model,
                instructions: request.systemPrompt,
                input: request.messages,
                max_output_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
                temperature: request.temperature,
                store: false,
                ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {})
            },
            { signal: request.signal }
        )
        return {
            id: response.id,
            model: response.model,
            providerType: request.providerType,
            text: response.output_text.trim(),
            usage: response.usage
                ? {
                      inputTokens: response.usage.input_tokens,
                      outputTokens: response.usage.output_tokens,
                      totalTokens: response.usage.total_tokens,
                      cachedInputTokens: response.usage.input_tokens_details.cached_tokens,
                      reasoningTokens: response.usage.output_tokens_details.reasoning_tokens
                  }
                : undefined
        }
    }

    private async chatOpenAiCompletions(request: ChatRequest): Promise<ChatResponse> {
        const client = new OpenAI(openAiClientOptions(request))
        const reasoningEffort = resolveOpenAiReasoningEffort(
            request.model,
            request.reasoningEffort ?? 'none'
        )
        const response = await client.chat.completions.create(
            {
                model: request.model,
                messages: [
                    ...(request.systemPrompt
                        ? [{ role: 'system' as const, content: request.systemPrompt }]
                        : []),
                    ...request.messages
                ],
                max_completion_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
                temperature: request.temperature,
                ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {})
            },
            { signal: request.signal }
        )
        const usage = response.usage
        return {
            id: response.id,
            model: response.model,
            providerType: request.providerType,
            text: (response.choices[0]?.message.content ?? '').trim(),
            usage: usage
                ? {
                      inputTokens: usage.prompt_tokens,
                      outputTokens: usage.completion_tokens,
                      totalTokens: usage.total_tokens,
                      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens,
                      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens
                  }
                : undefined
        }
    }

    private async chatAnthropic(request: ChatRequest): Promise<ChatResponse> {
        const client = new Anthropic(anthropicClientOptions(request))
        const response = await client.messages.create(
            {
                model: request.model,
                system: request.systemPrompt,
                messages: request.messages,
                max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
                temperature: request.temperature,
                thinking: { type: 'disabled' }
            },
            { signal: request.signal }
        )
        return {
            id: response.id,
            model: response.model,
            providerType: request.providerType,
            text: extractAnthropicText(response.content),
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens,
                totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                cachedInputTokens:
                    (response.usage.cache_creation_input_tokens ?? 0) +
                    (response.usage.cache_read_input_tokens ?? 0),
                reasoningTokens: response.usage.output_tokens_details?.thinking_tokens
            }
        }
    }
}

function openAiClientOptions(request: ChatRequest): ConstructorParameters<typeof OpenAI>[0] {
    return {
        apiKey: request.apiKey,
        ...(request.baseUrl ? { baseURL: request.baseUrl } : {})
    }
}

function anthropicClientOptions(request: ChatRequest): ConstructorParameters<typeof Anthropic>[0] {
    return {
        apiKey: request.apiKey,
        ...(request.baseUrl ? { baseURL: request.baseUrl } : {})
    }
}

export function extractAnthropicText(content: Anthropic.Messages.ContentBlock[]): string {
    return content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .filter((text) => text.length > 0)
        .join('\n')
        .trim()
}

export function resolveOpenAiReasoningEffort(
    model: string,
    requested: ChatReasoningEffort
): ChatReasoningEffort | undefined {
    if (requested !== 'none') return requested
    if (supportsOpenAiNoReasoning(model)) return 'none'
    if (isOpenAiReasoningModel(model)) return 'minimal'
    return undefined
}

function supportsOpenAiNoReasoning(model: string): boolean {
    const normalized = model.toLowerCase()
    return normalized.startsWith('gpt-5.1')
}

function isOpenAiReasoningModel(model: string): boolean {
    const normalized = model.toLowerCase()
    return (
        normalized.startsWith('gpt-5') ||
        /^o\d/.test(normalized) ||
        normalized.startsWith('o-')
    )
}
