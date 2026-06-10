import { Injectable } from '@nestjs/common'
import type {
    BlackboardArtifactPreview,
    BlackboardEventView,
    BlackboardView,
    ConverseGroupPayload,
    CreateGroupChatPayload,
    DeployManifest,
    DeploymentEvent,
    DeploymentView,
    GroupAttachmentPreview,
    GroupAttachmentView,
    GroupChatView,
    GroupMessageView,
    GroupRunEvent,
    UpdateGroupChatPayload,
    WorkspaceCommitPayload,
    WorkspaceCommitResult,
    WorkspaceDiffSummary
} from '@agenthub/shared'
import { BlackboardService } from './blackboard/blackboard.service.js'
import { GroupChatService } from './group-chat.service.js'
import { GroupMessageService } from './group-message.service.js'
import {
    GroupAttachmentService,
    type UploadedGroupAttachmentFile
} from './group-attachment.service.js'
import { GroupRunStream } from './run/group-run-stream.service.js'
import { GroupRunExecutor } from './run/group-run.executor.js'
import { GroupArtifactPreviewService } from './group-artifact-preview.service.js'
import { GroupWorkspaceService } from './group-workspace.service.js'
import { WorkspaceDiffService } from '../workspace/workspace-diff.service.js'
import { DeploymentService } from './deployment/deployment.service.js'
import { BusinessException } from '../../common/index.js'
import { UpdateGroupMessageDto } from './dto/update-group-message.dto.js'

/**
 * GroupChatManager — 群聊领域的对外门面（控制器只依赖它，委派给聚焦服务）。
 * 沿用单聊 AgentManager 的门面模式。所有方法以 userId 做归属校验。
 */
@Injectable()
export class GroupChatManager {
    constructor(
        private readonly groupChat: GroupChatService,
        private readonly groupMessages: GroupMessageService,
        private readonly groupAttachments: GroupAttachmentService,
        private readonly blackboard: BlackboardService,
        private readonly artifactPreview: GroupArtifactPreviewService,
        private readonly workspace: GroupWorkspaceService,
        private readonly workspaceDiff: WorkspaceDiffService,
        private readonly deployments: DeploymentService,
        private readonly runStream: GroupRunStream,
        private readonly executor: GroupRunExecutor
    ) {}

    createGroupChat(userId: string, payload: CreateGroupChatPayload): Promise<GroupChatView> {
        return this.groupChat.createGroupChat(userId, payload)
    }

    listGroupChats(userId: string): Promise<GroupChatView[]> {
        return this.groupChat.listGroupChats(userId)
    }

    getGroupChat(userId: string, id: string): Promise<GroupChatView> {
        return this.groupChat.getGroupChat(userId, id)
    }

    updateGroupChat(
        userId: string,
        id: string,
        payload: UpdateGroupChatPayload
    ): Promise<GroupChatView> {
        return this.groupChat.updateGroupChat(userId, id, payload)
    }

    async deleteGroupChat(userId: string, id: string): Promise<{ deleted: true }> {
        await this.groupChat.loadGroup(userId, id)
        await this.deployments.stopAllForGroup(id)
        return this.groupChat.deleteGroupChat(userId, id)
    }

    async listMessages(userId: string, groupId: string): Promise<GroupMessageView[]> {
        await this.groupChat.loadGroup(userId, groupId)
        return this.groupMessages.listMessages(groupId)
    }

    async uploadAttachment(
        userId: string,
        groupId: string,
        file: UploadedGroupAttachmentFile | undefined
    ): Promise<GroupAttachmentView> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        return this.groupAttachments.upload(userId, group, file)
    }

    async previewAttachment(
        userId: string,
        groupId: string,
        attachmentId: string
    ): Promise<GroupAttachmentPreview> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        return this.groupAttachments.preview(userId, group, attachmentId)
    }

    async updateMessage(
        userId: string,
        groupId: string,
        messageId: string,
        payload: UpdateGroupMessageDto
    ): Promise<GroupMessageView> {
        await this.groupChat.loadGroup(userId, groupId)
        return this.groupMessages.updateMessage(groupId, messageId, payload)
    }

    async getWorkspaceDiff(userId: string, groupId: string): Promise<WorkspaceDiffSummary> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        return this.workspaceDiff.summarize(repoDir, 'group-chat', group.id)
    }

    async commitWorkspace(
        userId: string,
        groupId: string,
        payload: WorkspaceCommitPayload
    ): Promise<WorkspaceCommitResult> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        const activeRunId = await this.runStream.getActiveRun(group.id)
        if (activeRunId) {
            throw BusinessException.conflict(
                `Group ${group.id} is busy with active run ${activeRunId}`,
                { reason: 'GROUP_BUSY', activeRunId }
            )
        }
        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        return this.workspaceDiff.commit(repoDir, 'group-chat', group.id, payload)
    }

    converse(
        userId: string,
        groupId: string,
        payload: ConverseGroupPayload
    ): Promise<{ runId: string }> {
        return this.executor.startRun(userId, groupId, payload)
    }

    async subscribeRun(
        userId: string,
        groupId: string,
        runId: string
    ): Promise<AsyncIterable<GroupRunEvent>> {
        await this.groupChat.loadGroup(userId, groupId)
        if (!(await this.runStream.isRunInGroup(groupId, runId))) {
            throw BusinessException.notFound(`Run ${runId} does not belong to group ${groupId}`)
        }
        return this.runStream.subscribe(groupId, runId)
    }

    abortRun(userId: string, groupId: string, runId: string): Promise<{ aborted: true }> {
        return this.executor.abortRun(userId, groupId, runId)
    }

    async getBlackboard(userId: string, groupId: string): Promise<BlackboardView> {
        await this.groupChat.loadGroup(userId, groupId)
        return this.blackboard.getState(groupId)
    }

    async getArtifactPreview(
        userId: string,
        groupId: string,
        artifactId: string
    ): Promise<BlackboardArtifactPreview> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        return this.artifactPreview.preview(group.id, group.workspaceDir, artifactId)
    }

    async listBlackboardEvents(
        userId: string,
        groupId: string,
        limit?: number,
        offset?: number
    ): Promise<BlackboardEventView[]> {
        await this.groupChat.loadGroup(userId, groupId)
        return this.blackboard.listEvents(groupId, limit, offset)
    }

    // —— 部署（service 模式运行 dev server + 预览）——

    async startDeployment(
        userId: string,
        groupId: string,
        manifest: DeployManifest
    ): Promise<DeploymentView> {
        const group = await this.groupChat.loadGroup(userId, groupId)
        if (manifest.mode !== 'service') {
            throw BusinessException.badRequest('Only service deployments can be started')
        }
        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        return this.deployments.start(group.id, repoDir, manifest)
    }

    async stopDeployment(
        userId: string,
        groupId: string,
        deploymentId: string
    ): Promise<{ stopped: true }> {
        await this.groupChat.loadGroup(userId, groupId)
        await this.deployments.stop(groupId, deploymentId)
        return { stopped: true }
    }

    async subscribeDeployment(
        userId: string,
        groupId: string,
        deploymentId: string
    ): Promise<AsyncIterable<DeploymentEvent>> {
        await this.groupChat.loadGroup(userId, groupId)
        return this.deployments.subscribe(groupId, deploymentId)
    }
}
