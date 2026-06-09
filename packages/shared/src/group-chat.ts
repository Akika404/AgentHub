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
import type { BlackboardTaskNode, BlackboardTaskStatus, BlackboardUpdate, BlackboardArtifact } from './blackboard.js'
import type { DeployManifest } from './deployment.js'
import type { MessageReplyRef } from './chat.js'

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
  /** short human-authored capability summary from the Agent config */
  capabilitySummary: string | null
}

// —— Group chat ——

export type GroupChatStatus = 'active' | 'archived'

export interface GroupChatView {
  id: string
  title: string
  status: GroupChatStatus
  /** Cross-device list pin state. */
  isPinned: boolean
  /** null means the group is writable; non-null means archived/read-only. */
  archivedAt: string | null
  /** shared git workspace root (source of truth; Agent runtime dirs live under it) */
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
  /** Must be under the current user's agent_workspace; omit to let the server allocate it. */
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
  isPinned?: boolean
  /** true archives the group, false restores it to writable. */
  archived?: boolean
}

/**
 * Send a user message, starting one group run (detached background task).
 * `mentions` are member Agent ids and/or the literal `'orchestrator'`; empty or
 * omitted means "let the Orchestrator decide".
 */
export interface ConverseGroupPayload {
  text: string
  mentions?: string[]
  /** Uploaded attachment ids returned by `POST /group-chats/:id/attachments`. */
  attachmentIds?: string[]
  /**
   * When present, this message quotes an earlier presentation_log message. The
   * server resolves the quoted message's full text by `messageId` and injects it
   * (with a staleness caveat) into the dispatched member's task context; the
   * reference is also persisted on the user message for re-rendering.
   */
  replyTo?: MessageReplyRef
}

export interface StartGroupRunResult {
  runId: string
}

/** Update a group presentation_log message. Omitted fields are left unchanged. */
export interface UpdateGroupMessagePayload {
  pinned?: boolean
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
      /** Clean display text for terminal task states; raw member reports stay internal. */
      summary?: string
    }
  | {
      type: 'member_turn_event'
      runId: string
      /** null means a lightweight member chat turn, not a blackboard task. */
      taskId: string | null
      agentId: string
      event: AgentEvent
    }
  | {
      type: 'blackboard_update'
      runId: string
      /** task that produced the change; null for member-chat / orchestrator-driven changes */
      taskId: string | null
      /** member agent that produced the change; null for orchestrator/system-driven changes */
      agentId: string | null
      update: BlackboardUpdate
      /**
       * Full artifact snapshot when `update.kind === 'artifact'`, so the renderer can
       * attach an inline preview card to the producing member's run bubble without an
       * extra fetch. Omitted for non-artifact updates.
       */
      artifact?: BlackboardArtifact
    }
  | { type: 'orchestrator_report'; runId: string; text: string }
  | {
      /**
       * Emitted after the Orchestrator's final report (before `done`) when the
       * run produced a presentable deliverable. Carries the deploy manifest and
       * the artifacts the card lists, so the renderer can insert the card live.
       */
      type: 'deploy_card'
      runId: string
      manifest: DeployManifest
      artifacts: BlackboardArtifact[]
    }
  | { type: 'done'; runId: string; success: boolean }
