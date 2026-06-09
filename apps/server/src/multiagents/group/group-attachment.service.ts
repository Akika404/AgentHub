import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm'
import type { GroupAttachmentView } from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { GroupChat } from './entities/group-chat.entity.js'
import { GroupAttachment } from './entities/group-attachment.entity.js'
import { GroupWorkspaceService } from './group-workspace.service.js'

export const MAX_GROUP_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const MAX_GROUP_ATTACHMENTS_PER_MESSAGE = 5
const STALE_CLAIMED_ATTACHMENT_MS = 60 * 60 * 1000
const STALE_UNCONSUMED_ATTACHMENT_MS = 24 * 60 * 60 * 1000

export interface UploadedGroupAttachmentFile {
    originalname?: string
    mimetype?: string
    size?: number
    buffer?: Buffer
}

/**
 * Handles group chat uploads from staged bytes to workspace-visible files.
 */
@Injectable()
export class GroupAttachmentService {
    constructor(
        @InjectRepository(GroupAttachment)
        private readonly attachmentRepo: Repository<GroupAttachment>,
        private readonly workspace: GroupWorkspaceService,
        private readonly dataSource: DataSource
    ) {}

    async upload(
        userId: string,
        group: GroupChat,
        file: UploadedGroupAttachmentFile | undefined
    ): Promise<GroupAttachmentView> {
        if (group.status === 'archived' || group.archivedAt) {
            throw BusinessException.forbidden('Archived group chat is read-only')
        }
        await this.cleanupStaleUploads(userId, group).catch(() => undefined)
        if (!file?.buffer || !file.originalname) {
            throw BusinessException.badRequest('Attachment file is required')
        }
        const size = file.size ?? file.buffer.length
        if (size <= 0) throw BusinessException.badRequest('Attachment file cannot be empty')
        if (size > MAX_GROUP_ATTACHMENT_BYTES) {
            throw BusinessException.badRequest('Attachment file is too large', {
                maxBytes: MAX_GROUP_ATTACHMENT_BYTES,
                size
            })
        }

        const id = randomUUID()
        const safeName = this.safeFileName(file.originalname)
        const uploadDir = join(this.workspace.groupRuntimeDir(group.id, group.workspaceDir), 'uploads')
        await mkdir(uploadDir, { recursive: true })
        const tempPath = join(uploadDir, `${id}-${safeName}`)
        await writeFile(tempPath, file.buffer)

        const saved = await this.attachmentRepo.save(
            this.attachmentRepo.create({
                id,
                userId,
                groupChatId: group.id,
                originalName: basename(file.originalname),
                mimeType: file.mimetype?.trim() || 'application/octet-stream',
                size,
                tempPath,
                runId: null,
                workspacePath: null,
                consumedAt: null
            })
        )
        return this.toView(saved)
    }

    async consumeForRun(
        userId: string,
        group: GroupChat,
        attachmentIds: string[] | undefined,
        runId: string
    ): Promise<GroupAttachmentView[]> {
        const ids = this.normalizeAttachmentIds(attachmentIds)
        if (ids.length === 0) return []
        if (ids.length > MAX_GROUP_ATTACHMENTS_PER_MESSAGE) {
            throw BusinessException.badRequest('Too many attachments', {
                maxCount: MAX_GROUP_ATTACHMENTS_PER_MESSAGE,
                count: ids.length
            })
        }

        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        const destDir = resolve(repoDir, 'attachments', runId)
        this.assertInsideRepo(repoDir, destDir)

        const rows = await this.claimForRun(userId, group, ids, runId)
        const copiedPaths: string[] = []
        try {
            await mkdir(destDir, { recursive: true })

            const usedNames = new Set<string>()
            const consumedAt = new Date()
            for (const row of rows) {
                const fileName = this.uniqueName(this.safeFileName(row.originalName), usedNames)
                const destPath = resolve(destDir, fileName)
                this.assertInsideRepo(repoDir, destPath)
                await copyFile(row.tempPath, destPath)
                copiedPaths.push(destPath)
                row.workspacePath = this.toWorkspacePath(repoDir, destPath)
                row.consumedAt = consumedAt
            }

            const saved = await this.dataSource.transaction((manager) =>
                manager.getRepository(GroupAttachment).save(rows)
            )
            return saved.map((row) => this.toView(row))
        } catch (err) {
            await this.removeFiles(copiedPaths)
            await this.releaseRunClaim(userId, group, runId).catch(() => undefined)
            throw err
        }
    }

    async finalizeForRun(userId: string, group: GroupChat, runId: string): Promise<void> {
        const rows = await this.attachmentRepo.find({
            where: { userId, groupChatId: group.id, runId }
        })
        await Promise.all(rows.map((row) => unlink(row.tempPath).catch(() => undefined)))
    }

    async rollbackForRun(userId: string, group: GroupChat, runId: string): Promise<void> {
        const rows = await this.attachmentRepo.find({
            where: { userId, groupChatId: group.id, runId }
        })
        if (rows.length === 0) return

        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        await this.removeWorkspaceFiles(repoDir, rows)
        for (const row of rows) {
            row.runId = null
            row.workspacePath = null
            row.consumedAt = null
        }
        await this.attachmentRepo.save(rows)
    }

    async mirrorRunAttachmentsToWorktree(
        userId: string,
        group: GroupChat,
        runId: string,
        worktree: string
    ): Promise<number> {
        const rows = (
            await this.attachmentRepo.find({
                where: { userId, groupChatId: group.id, runId }
            })
        ).filter((row) => !!row.workspacePath)
        if (rows.length === 0) return 0

        const repoDir = this.workspace.repoDir(group.id, group.workspaceDir)
        const worktreeDir = resolve(worktree)
        const copiedPaths: string[] = []
        let copied = 0
        try {
            for (const row of rows) {
                const workspacePath = row.workspacePath
                if (!workspacePath) continue
                const sourcePath = resolve(repoDir, workspacePath)
                const destPath = resolve(worktreeDir, workspacePath)
                this.assertInsideRepo(repoDir, sourcePath)
                this.assertInsideDir(
                    worktreeDir,
                    destPath,
                    'Attachment mirror must be inside task worktree'
                )
                await mkdir(dirname(destPath), { recursive: true })
                await copyFile(sourcePath, destPath)
                copiedPaths.push(destPath)
                copied += 1
            }
        } catch (err) {
            await this.removeFiles(copiedPaths)
            throw err
        }
        return copied
    }

    async cleanupWorktreeAttachmentMirrors(worktree: string, runId: string): Promise<void> {
        const worktreeDir = resolve(worktree)
        const attachmentRoot = resolve(worktreeDir, 'attachments')
        const attachmentDir = resolve(attachmentRoot, runId)
        this.assertInsideDir(
            worktreeDir,
            attachmentRoot,
            'Attachment mirror must be inside task worktree'
        )
        this.assertInsideDir(
            attachmentRoot,
            attachmentDir,
            'Attachment mirror must be inside task worktree attachments'
        )
        await rm(attachmentDir, { recursive: true, force: true })
        await rmdir(attachmentRoot).catch(() => undefined)
    }

    renderPromptContext(attachments: GroupAttachmentView[]): string {
        if (attachments.length === 0) return ''
        return [
            '用户上传了以下文件，可在工作区读取。',
            '引用文件时必须使用 Markdown 链接格式：[文件名](相对路径)。',
            '引用文件内容时，先给出文件链接，再使用 Markdown blockquote（每行以 > 开头）。',
            ...attachments.map((attachment) => {
                const path = attachment.workspacePath ?? ''
                return `- [${this.escapeMarkdownLabel(attachment.originalName)}](${path}) (${attachment.mimeType}, ${attachment.size} bytes)`
            })
        ].join('\n')
    }

    toView(row: GroupAttachment): GroupAttachmentView {
        return {
            id: row.id,
            groupChatId: row.groupChatId,
            originalName: row.originalName,
            mimeType: row.mimeType,
            size: row.size,
            workspacePath: row.workspacePath,
            createdAt: row.createdAt.toISOString()
        }
    }

    private normalizeAttachmentIds(attachmentIds: string[] | undefined): string[] {
        return [...new Set((attachmentIds ?? []).map((id) => id.trim()).filter(Boolean))]
    }

    private async claimForRun(
        userId: string,
        group: GroupChat,
        ids: string[],
        runId: string
    ): Promise<GroupAttachment[]> {
        return this.dataSource.transaction(async (manager) => {
            const repo = manager.getRepository(GroupAttachment)
            const rows = await repo
                .createQueryBuilder('attachment')
                .setLock('pessimistic_write')
                .where('attachment.id IN (:...ids)', { ids })
                .andWhere('attachment.userId = :userId', { userId })
                .andWhere('attachment.groupChatId = :groupId', { groupId: group.id })
                .orderBy('attachment.id', 'ASC')
                .getMany()
            if (rows.length !== ids.length) {
                throw BusinessException.badRequest('Some attachments do not exist or are not yours')
            }

            const byId = new Map(rows.map((row) => [row.id, row]))
            const orderedRows = ids.map((id) => byId.get(id)!)
            const consumed = orderedRows.filter((row) => row.runId || row.workspacePath)
            if (consumed.length > 0) {
                throw BusinessException.badRequest('Some attachments have already been sent', {
                    attachmentIds: consumed.map((row) => row.id)
                })
            }

            for (const row of orderedRows) {
                row.runId = runId
                row.consumedAt = null
            }
            return repo.save(orderedRows)
        })
    }

    private async releaseRunClaim(
        userId: string,
        group: GroupChat,
        runId: string
    ): Promise<void> {
        const rows = await this.attachmentRepo.find({
            where: { userId, groupChatId: group.id, runId }
        })
        if (rows.length === 0) return
        for (const row of rows) {
            row.runId = null
            row.workspacePath = null
            row.consumedAt = null
        }
        await this.attachmentRepo.save(rows)
    }

    private async cleanupStaleUploads(userId: string, group: GroupChat): Promise<void> {
        const claimedCutoff = new Date(Date.now() - STALE_CLAIMED_ATTACHMENT_MS)
        const staleClaims = (
            await this.attachmentRepo.find({
                where: {
                    userId,
                    groupChatId: group.id,
                    workspacePath: IsNull(),
                    consumedAt: IsNull(),
                    createdAt: LessThan(claimedCutoff)
                }
            })
        ).filter((row) => row.runId)
        for (const row of staleClaims) {
            row.runId = null
        }
        if (staleClaims.length > 0) {
            await this.attachmentRepo.save(staleClaims)
        }

        const unconsumedCutoff = new Date(Date.now() - STALE_UNCONSUMED_ATTACHMENT_MS)
        const staleUnconsumed = await this.attachmentRepo.find({
            where: {
                userId,
                groupChatId: group.id,
                runId: IsNull(),
                workspacePath: IsNull(),
                createdAt: LessThan(unconsumedCutoff)
            }
        })
        if (staleUnconsumed.length === 0) return

        await Promise.all(staleUnconsumed.map((row) => unlink(row.tempPath).catch(() => undefined)))
        await this.attachmentRepo.delete({
            id: In(staleUnconsumed.map((row) => row.id)),
            userId,
            groupChatId: group.id
        })
    }

    private async removeWorkspaceFiles(repoDir: string, rows: GroupAttachment[]): Promise<void> {
        const paths = rows
            .map((row) => row.workspacePath)
            .filter((path): path is string => !!path)
            .map((path) => {
                const absPath = resolve(repoDir, path)
                this.assertInsideRepo(repoDir, absPath)
                return absPath
            })
        await this.removeFiles(paths)
    }

    private async removeFiles(paths: string[]): Promise<void> {
        await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)))
    }

    private safeFileName(value: string): string {
        const name = basename(value).trim() || 'attachment'
        const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
        return safe || 'attachment'
    }

    private uniqueName(name: string, usedNames: Set<string>): string {
        if (!usedNames.has(name)) {
            usedNames.add(name)
            return name
        }
        const dot = name.lastIndexOf('.')
        const base = dot > 0 ? name.slice(0, dot) : name
        const ext = dot > 0 ? name.slice(dot) : ''
        for (let i = 2; ; i += 1) {
            const candidate = `${base}-${i}${ext}`
            if (!usedNames.has(candidate)) {
                usedNames.add(candidate)
                return candidate
            }
        }
    }

    private toWorkspacePath(repoDir: string, filePath: string): string {
        return relative(repoDir, filePath).split('\\').join('/')
    }

    private assertInsideRepo(repoDir: string, filePath: string): void {
        this.assertInsideDir(repoDir, filePath, 'Attachment path must be inside the group workspace')
    }

    private assertInsideDir(rootDir: string, filePath: string, message: string): void {
        const rel = relative(rootDir, filePath)
        if (rel.startsWith('..') || rel === '..' || rel.length === 0) {
            throw BusinessException.badRequest(message)
        }
    }

    private escapeMarkdownLabel(value: string): string {
        return value.replace(/([\\[\]])/g, '\\$1')
    }
}
