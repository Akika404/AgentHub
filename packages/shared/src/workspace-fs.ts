export type ServerDirectoryRootKind = 'skills' | 'agent_home' | 'agent_workspace'

/** A server-side directory root the authenticated user may browse. */
export interface ServerDirectoryRoot {
  /** Stable id used by the client; currently the normalized root path. */
  id: string
  /** Absolute server path. */
  path: string
  /** Display label for the root selector. */
  label: string
  /** Business purpose for this root, when provided by the server. */
  kind?: ServerDirectoryRootKind
}

/** One child directory under a server-side path. */
export interface ServerDirectoryEntry {
  name: string
  /** Absolute server path. */
  path: string
  readable: boolean
}

/** Directory listing returned by the server-side workspace filesystem API. */
export interface ServerDirectoryListing {
  root: ServerDirectoryRoot
  /** Absolute server path that was listed. */
  path: string
  /** Parent path inside the same root; null when already at root. */
  parentPath: string | null
  entries: ServerDirectoryEntry[]
}
