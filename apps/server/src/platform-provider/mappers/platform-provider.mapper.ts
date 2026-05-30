import type { PlatformProvider } from '../entities/platform-provider.entity.js'
import type { PlatformProviderView } from '../dto/platform-provider-view.dto.js'

/**
 * 掩码 API 密钥：保留前 3 位与后 4 位，中间用 **** 代替。
 *
 * - 未加载（select:false 未取出，undefined）→ null
 * - 太短（≤ 8 位）→ 全部 ****，避免泄露过多
 */
export function maskApiKey(apiKey: string | undefined | null): string | null {
    if (!apiKey) return null
    if (apiKey.length <= 8) return '****'
    return `${apiKey.slice(0, 3)}****${apiKey.slice(-4)}`
}

/**
 * PlatformProvider 实体 → 对外视图。
 *
 * 不暴露 userId；apiKey 只回掩码（绝不回明文）；Date 归一为 ISO 字符串。
 */
export function toPlatformProviderView(entity: PlatformProvider): PlatformProviderView {
    return {
        id: entity.id,
        platformName: entity.platformName,
        type: entity.type,
        baseUrl: entity.baseUrl,
        modelList: entity.modelList ?? [],
        apiKeyMasked: maskApiKey(entity.apiKey),
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString()
    }
}
