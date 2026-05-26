export interface ApiResponse<T> {
  code: number
  message: string
  data: T | null
  timestamp: string
}

export const SUCCESS_CODE = 0
export const SUCCESS_MESSAGE = 'ok'

export function buildSuccess<T>(data: T): ApiResponse<T> {
  return {
    code: SUCCESS_CODE,
    message: SUCCESS_MESSAGE,
    data: data ?? null,
    timestamp: new Date().toISOString(),
  }
}

export function buildFailure(code: number, message: string): ApiResponse<null> {
  return {
    code,
    message,
    data: null,
    timestamp: new Date().toISOString(),
  }
}
