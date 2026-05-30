import { applyDecorators, type Type } from '@nestjs/common'
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger'
import { ApiResponseDto } from '../dto/api-response.dto.js'

interface EnvelopeOptions {
    /** data 是否为数组 */
    isArray?: boolean
    /** 响应描述 */
    description?: string
    /**
     * HTTP 状态码。默认 200；NestJS 中 @Post() 默认返回 201，
     * 这类路由应显式传入 201 以与运行时一致。
     */
    status?: number
}

/**
 * 声明一个「统一信封」响应：{ code, message, data, timestamp }，
 * 其中 data 用传入的 model 覆盖（allOf 合并基础信封 + 具体数据形状）。
 *
 * @example
 *   @ApiEnvelope(AgentViewDto)                       // data: AgentViewDto
 *   @ApiEnvelope(AgentViewDto, { isArray: true })    // data: AgentViewDto[]
 *   @ApiEnvelope(AgentViewDto, { status: 201 })      // @Post() 路由
 *   @ApiEnvelope()                                   // data: null（无返回体）
 *
 * 这里只声明文档；运行时信封仍由 ResponseInterceptor 构造。
 */
export function ApiEnvelope(model?: Type<unknown>, options: EnvelopeOptions = {}): MethodDecorator {
    const dataSchema = model
        ? options.isArray
            ? { type: 'array', items: { $ref: getSchemaPath(model) } }
            : { $ref: getSchemaPath(model) }
        : { type: 'object', nullable: true }

    return applyDecorators(
        ApiExtraModels(ApiResponseDto, ...(model ? [model] : [])),
        ApiResponse({
            status: options.status ?? 200,
            description: options.description,
            schema: {
                allOf: [
                    { $ref: getSchemaPath(ApiResponseDto) },
                    { properties: { data: dataSchema } }
                ]
            }
        })
    )
}
