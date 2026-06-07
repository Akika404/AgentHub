import type { BlackboardArtifact } from '../api'

const HIDDEN_ARTIFACT_DIRS = new Set(['.codex', '.agents', '.claude'])

export function shouldShowBlackboardArtifact(artifact: BlackboardArtifact): boolean {
  return !artifact.path.split(/[\\/]+/).some((segment) => HIDDEN_ARTIFACT_DIRS.has(segment))
}
