/**
 * Blackboard (group-chat shared source of truth) contract.
 * Mirrors `apps/server/src/multiagents/group/blackboard/dto/*` and
 * `apps/server/src/multiagents/group/memory/dto/*`.
 *
 * The blackboard is the single structured source of truth for a group chat:
 * artifacts (produced outputs), decisions, shared contracts and the task graph.
 * Agents read/write it instead of talking to each other directly.
 */

// —— Artifacts ——

export type BlackboardArtifactType = 'code' | 'document' | 'design' | 'test_report'
export type BlackboardArtifactStatus = 'draft' | 'proposed' | 'approved' | 'deprecated'

export interface BlackboardArtifact {
  id: string
  type: BlackboardArtifactType
  /** path within the group's shared workspace */
  path: string
  ownerAgentId: string
  /** optimistic-lock baseline; every write bumps it by 1 */
  version: number
  status: BlackboardArtifactStatus
  /** short summary injected to agents ("summary not full text") */
  summary: string
  updatedAt: string
  updatedByAgentId: string
}

// —— Decisions ——

export type BlackboardDecisionStatus = 'proposed' | 'approved' | 'superseded' | 'rejected'

export interface BlackboardDecision {
  id: string
  content: string
  rationale: string | null
  status: BlackboardDecisionStatus
  scope: string | null
  /** ids of decisions this one supersedes (they become `superseded`) */
  supersedes: string[]
  createdByAgentId: string
  /** 'orchestrator' | agentId | userId; null until approved */
  approvedBy: string | null
  ts: string
}

// —— Contracts ——

export interface BlackboardContract {
  /** stable contract id, e.g. "time_api" */
  id: string
  /** structured spec fields (endpoint/returns/...) */
  spec: Record<string, unknown>
  ownerAgentId: string
  /** consuming agent ids */
  consumers: string[]
  /** when true a non-owner change is rejected and escalated to the Orchestrator */
  approvalRequired: boolean
  version: number
}

// —— Task graph ——

export type BlackboardTaskStatus = 'pending' | 'ready' | 'doing' | 'done' | 'failed' | 'blocked'

export interface BlackboardTaskNode {
  id: string
  name: string
  /** assigned member agent id; null until the Orchestrator assigns it */
  agentId: string | null
  /** dependency task ids */
  deps: string[]
  status: BlackboardTaskStatus
  objective: string
}

// —— Aggregate view ——

export interface BlackboardView {
  artifacts: BlackboardArtifact[]
  decisions: BlackboardDecision[]
  contracts: BlackboardContract[]
  taskGraph: BlackboardTaskNode[]
}

// —— Events (append-only audit / run stream) ——

export type BlackboardUpdateKind = 'artifact' | 'decision' | 'contract' | 'task'
export type BlackboardUpdateOp = 'created' | 'updated' | 'superseded' | 'rejected'

/** Lightweight delta carried on the group-run stream (`blackboard_update`). */
export interface BlackboardUpdate {
  kind: BlackboardUpdateKind
  /** id of the affected blackboard object */
  targetId: string
  op: BlackboardUpdateOp
  summary: string
}

/** Persisted blackboard event (audit / debug feed). */
export interface BlackboardEventView extends BlackboardUpdate {
  id: string
  groupChatId: string
  /** agent that caused the change; null for system/orchestrator-driven changes */
  actorAgentId: string | null
  createdAt: string
}

// —— Agent private cross-task memory ——

export type AgentMemoryType = 'convention' | 'project_knowledge' | 'lesson' | 'work_done'
export type AgentMemoryStatus = 'active' | 'stale' | 'deprecated'
export type AgentMemorySourceType = 'blackboard' | 'self_summary' | 'user'

export interface AgentMemoryScope {
  project: string
  module: string | null
}

export interface AgentMemorySource {
  type: AgentMemorySourceType
  ref: string | null
}

export interface AgentMemoryItem {
  id: string
  agentId: string
  content: string
  type: AgentMemoryType
  scope: AgentMemoryScope
  source: AgentMemorySource
  status: AgentMemoryStatus
  createdAt: string
  lastUsedAt: string | null
}
