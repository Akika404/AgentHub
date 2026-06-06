import type {
    BlackboardArtifact,
    BlackboardContract,
    BlackboardDecision,
    BlackboardEventView,
    BlackboardTaskNode,
    BlackboardView
} from '@agenthub/shared'
import type { BlackboardArtifactEntity } from '../blackboard/entities/blackboard-artifact.entity.js'
import type { BlackboardContractEntity } from '../blackboard/entities/blackboard-contract.entity.js'
import type { BlackboardDecisionEntity } from '../blackboard/entities/blackboard-decision.entity.js'
import type { BlackboardEventEntity } from '../blackboard/entities/blackboard-event.entity.js'
import type { BlackboardTaskEntity } from '../blackboard/entities/blackboard-task.entity.js'

export function toArtifactView(e: BlackboardArtifactEntity): BlackboardArtifact {
    return {
        id: e.id,
        type: e.type,
        path: e.path,
        ownerAgentId: e.ownerAgentId,
        version: e.version,
        status: e.status,
        summary: e.summary,
        updatedAt: e.updatedAt.toISOString(),
        updatedByAgentId: e.updatedByAgentId
    }
}

export function toDecisionView(e: BlackboardDecisionEntity): BlackboardDecision {
    return {
        id: e.id,
        content: e.content,
        rationale: e.rationale,
        status: e.status,
        scope: e.scope,
        supersedes: e.supersedes ?? [],
        createdByAgentId: e.createdByAgentId,
        approvedBy: e.approvedBy,
        ts: e.createdAt.toISOString()
    }
}

export function toContractView(e: BlackboardContractEntity): BlackboardContract {
    return {
        id: e.contractKey,
        spec: e.spec,
        ownerAgentId: e.ownerAgentId,
        consumers: e.consumers ?? [],
        approvalRequired: e.approvalRequired,
        version: e.version
    }
}

export function toTaskView(e: BlackboardTaskEntity): BlackboardTaskNode {
    return {
        id: e.id,
        name: e.name,
        agentId: e.agentId,
        deps: e.deps ?? [],
        status: e.status,
        objective: e.objective
    }
}

export function toEventView(e: BlackboardEventEntity): BlackboardEventView {
    return {
        id: e.id,
        groupChatId: e.groupChatId,
        kind: e.kind,
        targetId: e.targetId,
        op: e.op,
        summary: e.summary,
        actorAgentId: e.actorAgentId,
        createdAt: e.createdAt.toISOString()
    }
}

export function toBlackboardView(
    artifacts: BlackboardArtifactEntity[],
    decisions: BlackboardDecisionEntity[],
    contracts: BlackboardContractEntity[],
    tasks: BlackboardTaskEntity[]
): BlackboardView {
    return {
        artifacts: artifacts.map(toArtifactView),
        decisions: decisions.map(toDecisionView),
        contracts: contracts.map(toContractView),
        taskGraph: tasks.map(toTaskView)
    }
}
