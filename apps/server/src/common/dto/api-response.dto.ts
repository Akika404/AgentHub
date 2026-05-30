import { ApiProperty } from '@nestjs/swagger'
import { SUCCESS_CODE, SUCCESS_MESSAGE } from './api-response.js'

/**
 * Swagger 文档模型：统一响应信封。
 *
 * 仅用于生成 OpenAPI schema —— 运行时真正的信封由 ResponseInterceptor 构造
 * （见 common/interceptors/response.interceptor.ts）。`data` 字段的具体形状
 * 由各路由上的 @ApiEnvelope(model) 装饰器通过 allOf 覆盖，这里只占位。
 */
export class ApiResponseDto {
    @ApiProperty({
        example: SUCCESS_CODE,
        description: '业务码：0 表示成功；非 0 见 ErrorCode（如 4000=NOT_FOUND、5002=AGENT_BUSY）'
    })
    code!: number

    @ApiProperty({ example: SUCCESS_MESSAGE, description: '提示信息，成功时为 "ok"' })
    message!: string

    @ApiProperty({ nullable: true, description: '业务数据；失败时为 null' })
    data!: unknown

    @ApiProperty({ example: '2026-05-30T12:00:00.000Z', description: 'ISO8601 响应时间戳' })
    timestamp!: string
}
