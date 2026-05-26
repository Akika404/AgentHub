import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable, map } from 'rxjs'
import { ApiResponse, buildSuccess } from '../dto/api-response'

/**
 * Wraps every successful controller return value in the unified ApiResponse envelope.
 *
 * If a controller already returns an object with a numeric `code` field
 * (i.e. it has already constructed its own envelope), it is passed through unchanged.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (isApiResponse<T>(data)) {
          return data
        }
        return buildSuccess<T>(data)
      }),
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
