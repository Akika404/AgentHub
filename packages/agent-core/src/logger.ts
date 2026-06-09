/**
 * Framework-agnostic logger seam.
 *
 * The adapters and WorkspaceGit originally depended on `@nestjs/common`'s
 * `Logger`. To let them run inside the desktop (a plain Node/Electron process
 * with no Nest container) this package depends only on this minimal interface.
 *
 * NestJS's `Logger` is structurally compatible, so the server can inject its
 * own logger directly. When no logger is provided we fall back to a no-op so
 * behaviour matches the previous default (silent at info level).
 */
export interface CoreLogger {
  debug(message: unknown, ...optionalParams: unknown[]): void
  warn(message: unknown, ...optionalParams: unknown[]): void
  error(message: unknown, ...optionalParams: unknown[]): void
}

/** A logger that discards everything. Default when the caller injects none. */
export const NOOP_LOGGER: CoreLogger = {
  debug() {},
  warn() {},
  error() {}
}
