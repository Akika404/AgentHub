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

/** One file collected from a user-selected local skill folder by the desktop app. */
export interface LocalSkillFolderFile {
  /** POSIX-style path relative to the selected local folder. */
  relativePath: string
  /** File bytes encoded as base64 for transport through the JSON API proxy. */
  contentBase64: string
  size: number
}

/** Upload payload for importing a user-selected local skill folder into server-side skills. */
export interface ImportLocalSkillFolderPayload {
  /** Display/source folder name; the server sanitizes it before creating a destination directory. */
  folderName: string
  files: LocalSkillFolderFile[]
}

/** Server-side result after a local skill folder is written under the current user's skills root. */
export interface ImportedSkillFolderView {
  /** Absolute server-side directory path that can be passed as a skillSourceDirectory. */
  directory: string
  /** Skill names detected from the uploaded folder. */
  skills: string[]
  fileCount: number
}
