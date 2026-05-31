/**
 * Unified response envelope shared with the backend.
 * Mirrors `apps/server/src/common/dto/api-response.ts`.
 */

export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
  /** ISO8601 */
  timestamp: string
}

/** Business code that marks a successful response. */
export const SUCCESS_CODE = 0

/**
 * Business error codes the frontend cares about.
 * Mirrors `apps/server/src/common/exceptions/error-code.ts`.
 */
export const ERROR_CODE = {
  VALIDATION_FAILED: 3000,
  BAD_REQUEST: 3001,
  UNAUTHORIZED: 2001,
  FORBIDDEN: 2002,
  INVALID_CREDENTIALS: 2003,
  ACCOUNT_DEACTIVATED: 2004,
  NOT_FOUND: 4000,
  CONFLICT: 4001,
  UPSTREAM_ERROR: 5000,
  AGENT_UNAVAILABLE: 5001,
  AGENT_BUSY: 5002
} as const
