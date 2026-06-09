import type { ProviderType } from '../entities/platform-provider.entity.js'

/**
 * 对外返回的 Provider 视图。
 * 与实体分离：不回传 apiKey 明文，只回掩码（apiKeyMasked）；不暴露 userId 等内部字段。
 */
export interface PlatformProviderView {
    id: string
    /** 平台展示名 */
    platformName: string
    type: ProviderType
    baseUrl: string
    /** 模型名列表 */
    modelList: string[]
    /** 是否为当前用户默认 Provider */
    isDefault: boolean
    /** 默认模型；非默认 Provider 为 null */
    defaultModel: string | null
    /** API 密钥掩码，如 `sk-****wl7g`；无密钥时为 null。绝不回明文 */
    apiKeyMasked: string | null
    /** 创建时间，ISO8601 */
    createdAt: string
    /** 更新时间，ISO8601 */
    updatedAt: string
}

/** 测试连接的结果。 */
export interface ProviderTestResult {
    /** 是否连通（能成功调用上游） */
    ok: boolean
    /** 本次探测耗时（毫秒） */
    latencyMs: number
    /** 连通时拉到的可用模型数量 */
    modelCount?: number
    /** 失败原因；ok 为 true 时不返回 */
    message?: string
}
