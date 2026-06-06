/**
 * Group chat collaboration contract.
 * Mirrors `apps/server/src/multiagents/group/dto/*`.
 *
 * A group chat pulls several already-configured Agents into one session around a
 * shared blackboard + a shared git workspace, coordinated by a built-in
 * Orchestrator. Members never talk to each other directly; they read/write the
 * blackboard. See `doc/context/群聊上下文管理设计方案.md`.
 */
import type { AgentVendor, AgentCapabilities, AgentEvent } from './agent.js'
import type { BlackboardTaskNode, BlackboardTaskStatus, BlackboardUpdate } from './blackboard.js'

// —— Project meta (lives on the group chat, not a separate table) ——

export type ProjectStatus = 'planning' | 'designing' | 'development' | 'done'

export interface ProjectMeta {
  name: string
  goal: string | null
  techStack: string[]
  status: ProjectStatus
}

/** Project meta input; only `name` is required, the rest default server-side. */
export interface ProjectMetaInput {
  name: string
  goal?: string | null
  techStack?: string[]
  status?: ProjectStatus
}

// —— Orchestrator (independent built-in role) ——

/**
 * Orchestrator runtime config. Decoupled from member Agents and configured per
 * group. `systemPrompt` is system-supplied (the orchestration prompt) and not
 * part of the contract.
 */
export interface OrchestratorConfigView {
  vendor: AgentVendor
  model: string
  /** referenced platform_provider.id */
  providerId: string
}

export type OrchestratorConfigInput = OrchestratorConfigView

// —— Members ——

export interface GroupMemberView {
  agentId: string
  name: string
  avatar: string | null
  color: string
  vendor: AgentVendor
  capabilities: AgentCapabilities
  /** free-text capability tag, e.g. "前端" / "后端"; null when unset */
  roleInGroup: string | null
}

// —— Group chat ——

export type GroupChatStatus = 'active' | 'archived'

export interface GroupChatView {
  id: string
  title: string
  status: GroupChatStatus
  /** shared git workspace root (source of truth + worktree base) */
  workspaceDir: string
  orchestrator: OrchestratorConfigView
  members: GroupMemberView[]
  projectMeta: ProjectMeta
  /** in-progress group run; null when idle (used to subscribe on open) */
  activeRunId: string | null
  createdAt: string
  updatedAt: string
}

// —— Payloads ——

export interface CreateGroupChatPayload {
  title: string
  /** member Agent ids (each must belong to the current user) */
  memberAgentIds: string[]
  orchestrator: OrchestratorConfigInput
  projectMeta: ProjectMetaInput
  /** omit to let the server allocate the shared workspace directory */
  workspaceDir?: string
}

/**
 * Update group chat input. Omitted fields are left unchanged. Minimal MVP:
 * rename, edit project meta, add members.
 */
export interface UpdateGroupChatPayload {
  title?: string
  projectMeta?: ProjectMetaInput
  /** member Agent ids to add (add-only in MVP) */
  addMemberAgentIds?: string[]
}

/**
 * Send a user message, starting one group run (detached background task).
 * `mentions` are member Agent ids and/or the literal `'orchestrator'`; empty or
 * omitted means "let the Orchestrator decide".
 */
export interface ConverseGroupPayload {
  text: string
  mentions?: string[]
}

export interface StartGroupRunResult {
  runId: string
}

// —— Routing ——

export type GroupRouteKind = 'direct_single' | 'multi' | 'orchestrate'

// —— Group run event stream (SSE: replay + tail) ——

/**
 * Events emitted on a group run's stream. One user message = one group run = one
 * Redis stream; `member_turn_event` re-broadcasts the inner member turn's events
 * (thinking/tool/text) so a single subscription watches the whole run.
 */
export type GroupRunEvent =
  | {
      type: 'orchestrator_plan'
      runId: string
      routeKind: GroupRouteKind
      tasks: BlackboardTaskNode[]
    }
  | {
      type: 'task_status'
      runId: string
      taskId: string
      status: BlackboardTaskStatus
      agentId: string | null
    }
  | {
      type: 'member_turn_event'
      runId: string
      taskId: string
      agentId: string
      event: AgentEvent
    }
  | { type: 'blackboard_update'; runId: string; update: BlackboardUpdate }
  | { type: 'orchestrator_report'; runId: string; text: string }
  | { type: 'done'; runId: string; success: boolean }
