import { SetMetadata } from '@nestjs/common'

export const SKIP_ENVELOPE = 'skipEnvelope'

/**
 * 标记某个路由跳过统一 ApiResponse 封装。
 *
 * 用于 SSE（@Sse()）等返回原始流的接口：ResponseInterceptor 默认会把每个
 * 返回值套进 envelope，会破坏 MessageEvent 流，因此这类路由必须显式跳过。
 */
export const SkipEnvelope = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ENVELOPE, true)
