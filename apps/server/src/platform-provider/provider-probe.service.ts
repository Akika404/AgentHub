import { Injectable } from '@nestjs/common'
import { BusinessException } from '../common/index.js'
import type { ProviderType } from './entities/platform-provider.entity.js'
import type { ProviderTestResult } from './dto/platform-provider-view.dto.js'

/** 探测上游的超时（毫秒） */
const PROBE_TIMEOUT_MS = 10_000
/** Anthropic 必传的版本头 */
const ANTHROPIC_VERSION = '2023-06-01'

/** 上游「列模型」请求的 url 与鉴权头（按协议类型构造）。 */
interface ModelsRequest {
    url: string
    headers: Record<string, string>
}

/**
 * 按协议类型构造「列模型」请求。
 *
 * - OpenAI（Chat Completions / Responses）：同一套 REST，`GET {base}/models`，Bearer 鉴权。
 *   约定 baseUrl 已含版本段（如 https://api.openai.com/v1）。
 * - Anthropic：`GET {base}/v1/models`，`x-api-key` + `anthropic-version` 鉴权。
 *   baseUrl 若已以 /v1 结尾则不再重复拼接。
 */
function buildModelsRequest(type: ProviderType, baseUrl: string, apiKey: string): ModelsRequest {
    const base = baseUrl.replace(/\/+$/, '')
    switch (type) {
        case 'openai-chat-completions':
        case 'openai-responses':
            return {
                url: `${base}/models`,
                headers: { Authorization: `Bearer ${apiKey}` }
            }
        case 'anthropic':
            return {
                url: base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`,
                headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION }
            }
    }
}

/** 取错误的可读信息。 */
function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

/**
 * ProviderProbeService —— 对上游做只读探测。
 *
 * 仅用于「测试连接」与「拉取模型列表」：两者都打上游的列模型接口（GET /models），
 * 不产生 token 费用。所有出网请求带 10s 超时，上游异常归一为 UPSTREAM_ERROR。
 */
@Injectable()
export class ProviderProbeService {
    /**
     * 拉取上游可用模型 id 列表。
     * 上游不可达 / 返回非 2xx → 抛 UPSTREAM_ERROR（502）。
     */
    async listModels(type: ProviderType, baseUrl: string, apiKey: string): Promise<string[]> {
        const { url, headers } = buildModelsRequest(type, baseUrl, apiKey)

        let res: Response
        try {
            res = await fetch(url, {
                method: 'GET',
                headers,
                signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
            })
        } catch (err) {
            throw BusinessException.upstream('无法连接到 provider', errorMessage(err))
        }

        if (!res.ok) {
            const detail = await res.text().catch(() => '')
            throw BusinessException.upstream(`provider 返回 HTTP ${res.status}`, detail)
        }

        const json = (await res.json().catch(() => null)) as {
            data?: Array<{ id?: unknown }>
        } | null
        const data = json?.data
        if (!Array.isArray(data)) return []
        return data.map((item) => item?.id).filter((id): id is string => typeof id === 'string')
    }

    /**
     * 测试连接：成功返回 ok:true 与模型数；失败不抛异常，而是返回 ok:false + 原因，
     * 便于前端直接展示（测试本身「成功完成」，连不连通是其结果）。
     */
    async test(type: ProviderType, baseUrl: string, apiKey: string): Promise<ProviderTestResult> {
        const start = performance.now()
        try {
            const models = await this.listModels(type, baseUrl, apiKey)
            return {
                ok: true,
                latencyMs: Math.round(performance.now() - start),
                modelCount: models.length
            }
        } catch (err) {
            return {
                ok: false,
                latencyMs: Math.round(performance.now() - start),
                message: errorMessage(err)
            }
        }
    }
}
