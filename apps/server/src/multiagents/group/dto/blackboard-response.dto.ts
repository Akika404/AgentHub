import { ApiProperty } from '@nestjs/swagger'
import type {
    BlackboardArtifact,
    BlackboardArtifactStatus,
    BlackboardArtifactType,
    BlackboardContract,
    BlackboardDecision,
    BlackboardDecisionStatus,
    BlackboardEventView,
    BlackboardTaskNode,
    BlackboardTaskStatus,
    BlackboardUpdateKind,
    BlackboardUpdateOp,
    BlackboardView
} from '@agenthub/shared'

const ARTIFACT_TYPES: BlackboardArtifactType[] = ['code', 'document', 'design', 'test_report']
const ARTIFACT_STATUSES: BlackboardArtifactStatus[] = ['draft', 'proposed', 'approved', 'deprecated']
const DECISION_STATUSES: BlackboardDecisionStatus[] = ['proposed', 'approved', 'superseded', 'rejected']
const TASK_STATUSES: BlackboardTaskStatus[] = ['pending', 'ready', 'doing', 'done', 'failed']
const UPDATE_KINDS: BlackboardUpdateKind[] = ['artifact', 'decision', 'contract', 'task']
const UPDATE_OPS: BlackboardUpdateOp[] = ['created', 'updated', 'superseded', 'rejected']

export class BlackboardArtifactDto implements BlackboardArtifact {
    @ApiProperty() id!: string
    @ApiProperty({ enum: ARTIFACT_TYPES }) type!: BlackboardArtifactType
    @ApiProperty() path!: string
    @ApiProperty() ownerAgentId!: string
    @ApiProperty({ description: '乐观锁基准版本' }) version!: number
    @ApiProperty({ enum: ARTIFACT_STATUSES }) status!: BlackboardArtifactStatus
    @ApiProperty({ description: '供"注摘要不注全文"的摘要' }) summary!: string
    @ApiProperty() updatedAt!: string
    @ApiProperty() updatedByAgentId!: string
}

export class BlackboardDecisionDto implements BlackboardDecision {
    @ApiProperty() id!: string
    @ApiProperty() content!: string
    @ApiProperty({ type: String, nullable: true }) rationale!: string | null
    @ApiProperty({ enum: DECISION_STATUSES }) status!: BlackboardDecisionStatus
    @ApiProperty({ type: String, nullable: true }) scope!: string | null
    @ApiProperty({ type: [String], description: '取代的旧决策 id' }) supersedes!: string[]
    @ApiProperty() createdByAgentId!: string
    @ApiProperty({ type: String, nullable: true }) approvedBy!: string | null
    @ApiProperty() ts!: string
}

export class BlackboardContractDto implements BlackboardContract {
    @ApiProperty({ description: '稳定契约 id，如 time_api' }) id!: string
    @ApiProperty({ type: 'object', additionalProperties: true }) spec!: Record<string, unknown>
    @ApiProperty() ownerAgentId!: string
    @ApiProperty({ type: [String] }) consumers!: string[]
    @ApiProperty() approvalRequired!: boolean
    @ApiProperty() version!: number
}

export class BlackboardTaskNodeDto implements BlackboardTaskNode {
    @ApiProperty() id!: string
    @ApiProperty() name!: string
    @ApiProperty({ type: String, nullable: true }) agentId!: string | null
    @ApiProperty({ type: [String] }) deps!: string[]
    @ApiProperty({ enum: TASK_STATUSES }) status!: BlackboardTaskStatus
    @ApiProperty() objective!: string
}

export class BlackboardViewDto implements BlackboardView {
    @ApiProperty({ type: [BlackboardArtifactDto] }) artifacts!: BlackboardArtifactDto[]
    @ApiProperty({ type: [BlackboardDecisionDto] }) decisions!: BlackboardDecisionDto[]
    @ApiProperty({ type: [BlackboardContractDto] }) contracts!: BlackboardContractDto[]
    @ApiProperty({ type: [BlackboardTaskNodeDto] }) taskGraph!: BlackboardTaskNodeDto[]
}

export class BlackboardEventViewDto implements BlackboardEventView {
    @ApiProperty() id!: string
    @ApiProperty() groupChatId!: string
    @ApiProperty({ enum: UPDATE_KINDS }) kind!: BlackboardUpdateKind
    @ApiProperty() targetId!: string
    @ApiProperty({ enum: UPDATE_OPS }) op!: BlackboardUpdateOp
    @ApiProperty() summary!: string
    @ApiProperty({ type: String, nullable: true }) actorAgentId!: string | null
    @ApiProperty() createdAt!: string
}
