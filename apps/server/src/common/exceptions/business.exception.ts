import { HttpException, HttpStatus } from '@nestjs/common'
import { ERROR_CODE_HTTP_STATUS, ErrorCode } from './error-code.js'

/**
 * Unified business exception.
 *
 * All deliberately-thrown errors from controllers/services should use this class
 * (or a subclass) so the global exception filter can produce a consistent
 * response envelope. Never throw raw `Error` to the client.
 */
export class BusinessException extends HttpException {
    readonly code: ErrorCode
    readonly details?: unknown

    constructor(code: ErrorCode, message?: string, details?: unknown) {
        const httpStatus = ERROR_CODE_HTTP_STATUS[code] ?? HttpStatus.INTERNAL_SERVER_ERROR
        super(
            {
                code,
                message: message ?? ErrorCode[code],
                details
            },
            httpStatus
        )
        this.code = code
        this.details = details
    }

    static notFound(message = 'Resource not found', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.NOT_FOUND, message, details)
    }

    static badRequest(message = 'Bad request', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.BAD_REQUEST, message, details)
    }

    static unauthorized(message = 'Unauthorized', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.UNAUTHORIZED, message, details)
    }

    static forbidden(message = 'Forbidden', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.FORBIDDEN, message, details)
    }

    static invalidCredentials(
        message = 'Invalid credentials',
        details?: unknown
    ): BusinessException {
        return new BusinessException(ErrorCode.INVALID_CREDENTIALS, message, details)
    }

    static accountDeactivated(
        message = 'Account deactivated',
        details?: unknown
    ): BusinessException {
        return new BusinessException(ErrorCode.ACCOUNT_DEACTIVATED, message, details)
    }

    static conflict(message = 'Resource conflict', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.CONFLICT, message, details)
    }

    static upstream(message = 'Upstream error', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.UPSTREAM_ERROR, message, details)
    }

    static agentUnavailable(message = 'Agent unavailable', details?: unknown): BusinessException {
        return new BusinessException(ErrorCode.AGENT_UNAVAILABLE, message, details)
    }

    static agentBusy(
        message = 'Agent is busy with another turn',
        details?: unknown
    ): BusinessException {
        return new BusinessException(ErrorCode.AGENT_BUSY, message, details)
    }
}
