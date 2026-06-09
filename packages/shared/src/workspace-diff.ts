export type WorkspaceDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'other'

export interface WorkspaceDiffFile {
  path: string
  oldPath?: string | null
  status: WorkspaceDiffFileStatus
  additions: number
  deletions: number
  diff: string | null
  expandable: boolean
  tooLarge: boolean
}

export interface WorkspaceDiffSummary {
  id: string
  scope: 'agent-chat' | 'group-chat'
  ownerId: string
  baseRef: string | null
  headRef: string | null
  clean: boolean
  files: WorkspaceDiffFile[]
  generatedAt: string
}

export interface WorkspaceCommitPayload {
  message?: string
}

export interface WorkspaceCommitResult {
  committed: boolean
  commitHash: string | null
  message: string | null
  diff: WorkspaceDiffSummary
}
