import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { ApiResponse, buildFailure } from '../dto/api-response.js'
import { BusinessException } from '../exceptions/business.exception.js'
import { ErrorCode } from '../exceptions/error-code.js'

interface NormalizedError {
  httpStatus: number
  code: number
  message: string
  details?: unknown
}

/**
 * Global exception filter — converts every error thrown anywhere in the request
 * lifecycle into the unified ApiResponse envelope.
 *
 * Precedence:
 *   1. BusinessException → use its business code + HTTP status + details
 *   2. HttpException (incl. NestJS built-ins, ValidationPipe) → map HTTP status to a sensible code
 *   3. Anything else → INTERNAL_ERROR / 500 (full stack logged, not exposed)
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    const normalized = this.normalize(exception)

    const body: ApiResponse<null> = {
      ...buildFailure(normalized.code, normalized.message),
    }
    if (normalized.details !== undefined) {
      ;(body as ApiResponse<null> & { details?: unknown }).details = normalized.details
    }

    this.log(exception, normalized, request)

    response.status(normalized.httpStatus).json(body)
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof BusinessException) {
      const payload = exception.getResponse() as {
        code?: number
        message?: string
        details?: unknown
      }
      return {
        httpStatus: exception.getStatus(),
        code: payload.code ?? exception.code,
        message: payload.message ?? exception.message,
        details: payload.details,
      }
    }

    if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus()
      const raw = exception.getResponse()
      const message = this.extractHttpMessage(raw, exception.message)
      const details = typeof raw === 'object' && raw !== null ? raw : undefined
      return {
        httpStatus,
        code: this.mapHttpStatusToCode(httpStatus),
        message,
        details,
      }
    }

    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    }
  }

  private extractHttpMessage(raw: unknown, fallback: string): string {
    if (typeof raw === 'string') return raw
    if (raw && typeof raw === 'object') {
      const message = (raw as { message?: unknown }).message
      if (typeof message === 'string') return message
      if (Array.isArray(message) && message.length > 0) {
        return message.map((m) => String(m)).join('; ')
      }
    }
    return fallback
  }

  private mapHttpStatusToCode(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_FAILED
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT
      case HttpStatus.BAD_GATEWAY:
        return ErrorCode.UPSTREAM_ERROR
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.AGENT_UNAVAILABLE
      default:
        return ErrorCode.INTERNAL_ERROR
    }
  }

  private log(exception: unknown, normalized: NormalizedError, request: Request): void {
    const where = `${request.method} ${request.originalUrl ?? request.url}`
    if (normalized.httpStatus >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined
      this.logger.error(
        `[${normalized.code}] ${normalized.message} @ ${where}`,
        stack,
      )
    } else {
      this.logger.warn(`[${normalized.code}] ${normalized.message} @ ${where}`)
    }
  }
}
