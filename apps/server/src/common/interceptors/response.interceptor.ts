import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, map } from 'rxjs'
import { ApiResponse, buildSuccess } from '../dto/api-response.js'
import { SKIP_ENVELOPE } from '../decorators/skip-envelope.decorator.js'

/**
 * Wraps every successful controller return value in the unified ApiResponse envelope.
 *
 * Two pass-throughs (left unwrapped):
 *   1. Routes marked with `@SkipEnvelope()` (e.g. SSE streams) — wrapping each
 *      emission would corrupt the `MessageEvent` stream.
 *   2. Values already shaped like an ApiResponse (a controller built its own envelope).
 *
 * `Reflector` is constructed locally because this interceptor is registered via
 * `new ResponseInterceptor()` in main.ts (not through Nest DI). Reflector has no
 * dependencies — it only wraps `Reflect.getMetadata`.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
    private readonly reflector = new Reflector()

    intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, [
            context.getHandler(),
            context.getClass()
        ])
        if (skip) {
            return next.handle()
        }
        return next.handle().pipe(
            map((data) => {
                if (isApiResponse<T>(data)) {
                    return data
                }
                return buildSuccess<T>(data)
            })
        )
    }
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { code?: unknown }).code === 'number' &&
        'data' in value &&
        'message' in value
    )
}
