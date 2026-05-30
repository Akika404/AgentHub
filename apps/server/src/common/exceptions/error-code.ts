import { HttpStatus } from '@nestjs/common'

/**
 * Business error codes.
 *
 * Convention:
 *   0           — success (reserved, never appears here)
 *   1xxx        — generic / framework-level
 *   2xxx        — auth / permission
 *   3xxx        — validation / bad request
 *   4xxx        — resource (not found / conflict)
 *   5xxx        — upstream / integration (LLM, third-party agent)
 *   9xxx        — unknown / internal
 */
export enum ErrorCode {
    // generic
    UNKNOWN = 9999,
    INTERNAL_ERROR = 9000,

    // validation
    VALIDATION_FAILED = 3000,
    BAD_REQUEST = 3001,

    // auth
    UNAUTHORIZED = 2001,
    FORBIDDEN = 2002,

    // resource
    NOT_FOUND = 4000,
    CONFLICT = 4001,

    // upstream / agent
    UPSTREAM_ERROR = 5000,
    AGENT_UNAVAILABLE = 5001,
    AGENT_BUSY = 5002
}

/** Map business error codes to HTTP status codes for response framing. */
export const ERROR_CODE_HTTP_STATUS: Record<ErrorCode, HttpStatus> = {
    [ErrorCode.UNKNOWN]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
    [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
    [ErrorCode.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
    [ErrorCode.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
    [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
    [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
    [ErrorCode.UPSTREAM_ERROR]: HttpStatus.BAD_GATEWAY,
    [ErrorCode.AGENT_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
    [ErrorCode.AGENT_BUSY]: HttpStatus.CONFLICT
}
