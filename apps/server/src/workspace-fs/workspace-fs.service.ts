import { Injectable, Logger } from '@nestjs/common'
import { access, mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import type {
    ImportedSkillFolderView,
    ImportLocalSkillFolderPayload,
    LocalSkillFolderFile,
    ServerDirectoryEntry,
    ServerDirectoryListing,
    ServerDirectoryRoot
} from '@agenthub/shared'
import { BusinessException } from '../common/index.js'
import { UserWorkspaceService } from '../user-workspace/user-workspace.service.js'
import { AgentWorkspaceService } from '../multiagents/workspace/agent-workspace.service.js'

interface ResolvedRoot extends ServerDirectoryRoot {
    path: string
}

export const MAX_LOCAL_SKILL_IMPORT_MANIFEST_BYTES = 40 * 1024 * 1024
const MAX_LOCAL_SKILL_IMPORT_BYTES = 20 * 1024 * 1024
const MAX_LOCAL_SKILL_IMPORT_FILE_BYTES = 5 * 1024 * 1024
const MAX_LOCAL_SKILL_IMPORT_FILES = 300
const BASE64_RE =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

export interface UploadedLocalSkillManifestFile {
    originalname?: string
    mimetype?: string
    size?: number
    buffer?: Buffer
}

@Injectable()
export class WorkspaceFsService {
    private readonly logger = new Logger(WorkspaceFsService.name)

    constructor(
        private readonly userWorkspace: UserWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService
    ) {}

    async roots(userId: string): Promise<ServerDirectoryRoot[]> {
        return this.resolveRoots(userId)
    }

    async listDirectories(userId: string, rawPath?: string): Promise<ServerDirectoryListing> {
        const roots = await this.resolveRoots(userId)
        if (roots.length === 0) {
            throw BusinessException.badRequest('No server workspace roots are available')
        }

        const requested = rawPath?.trim()
        const requestedPath = requested
            ? await this.userWorkspace.assertPathInRoot(
                  userId,
                  this.findRequestedKind(requested, roots),
                  requested,
                  'Directory'
              )
            : roots[0].path
        await this.assertReadableDirectory(requestedPath)
        const path = await realpath(requestedPath)
        const root = this.findContainingRoot(path, roots)
        if (!root) {
            throw BusinessException.forbidden('Directory is outside current user workspace roots', {
                path,
                roots: roots.map((r) => r.path)
            })
        }

        const entries = await this.childDirectories(path)
        return {
            root,
            path,
            parentPath: this.parentInsideRoot(path, root),
            entries
        }
    }

    async importLocalSkillFolder(
        userId: string,
        file: UploadedLocalSkillManifestFile | undefined
    ): Promise<ImportedSkillFolderView> {
        if (!file?.buffer) {
            throw BusinessException.badRequest('Local skill folder manifest is required')
        }
        const manifestBytes = file.size ?? file.buffer.length
        if (manifestBytes <= 0) {
            throw BusinessException.badRequest('Local skill folder manifest cannot be empty')
        }
        if (manifestBytes > MAX_LOCAL_SKILL_IMPORT_MANIFEST_BYTES) {
            throw BusinessException.badRequest('Local skill folder manifest is too large', {
                maxBytes: MAX_LOCAL_SKILL_IMPORT_MANIFEST_BYTES,
                size: manifestBytes
            })
        }

        const payload = this.parseImportPayload(file.buffer)
        const files = this.normalizeImportFiles(payload.files)
        const skillsRoot = await this.userWorkspace.rootDirectory(userId, 'skills')
        const directory = await this.allocateImportDirectory(
            skillsRoot,
            this.safeFolderName(payload.folderName)
        )

        try {
            for (const entry of files) {
                const relativePath = this.normalizeRelativeFilePath(entry.relativePath)
                const destination = resolve(directory, ...relativePath.split('/'))
                if (!this.userWorkspace.isInsideRoot(destination, directory)) {
                    throw BusinessException.forbidden('Skill file escapes import directory', {
                        relativePath
                    })
                }
                await mkdir(dirname(destination), { recursive: true })
                await writeFile(destination, Buffer.from(entry.contentBase64, 'base64'))
            }

            const skills = await this.agentWorkspace.listSkillNames(directory)
            return {
                directory: await realpath(directory),
                skills,
                fileCount: files.length
            }
        } catch (err) {
            await rm(directory, { recursive: true, force: true }).catch(() => undefined)
            throw err
        }
    }

    private async resolveRoots(userId: string): Promise<ResolvedRoot[]> {
        const rawRoots = await this.userWorkspace.browsableRoots(userId)
        const roots: ResolvedRoot[] = []
        const seen = new Set<string>()

        for (const root of rawRoots) {
            try {
                await this.assertReadableDirectory(root.path)
                const realRoot = await realpath(root.path)
                if (seen.has(realRoot)) continue
                seen.add(realRoot)
                roots.push({
                    id: realRoot,
                    path: realRoot,
                    label: root.label,
                    kind: root.kind
                })
            } catch (err) {
                this.logger.warn(
                    `Workspace root unavailable (${root.path}): ${this.errMsg(err)}`
                )
            }
        }

        return roots
    }

    private findContainingRoot(path: string, roots: ResolvedRoot[]): ResolvedRoot | null {
        return this.userWorkspace.findContainingRoot(resolve(path), roots)
    }

    private parentInsideRoot(path: string, root: ResolvedRoot): string | null {
        if (resolve(path) === root.path) return null
        const parent = resolve(path, '..')
        return this.userWorkspace.isInsideRoot(parent, root.path) ? parent : null
    }

    private async assertReadableDirectory(path: string): Promise<void> {
        let info: Awaited<ReturnType<typeof stat>>
        try {
            info = await stat(path)
        } catch (err) {
            throw BusinessException.badRequest(`Directory is not available: ${this.errMsg(err)}`, {
                path
            })
        }
        if (!info.isDirectory()) {
            throw BusinessException.badRequest('Path is not a directory', { path })
        }
        try {
            await access(path, constants.R_OK | constants.X_OK)
        } catch (err) {
            throw BusinessException.forbidden(`Directory is not readable: ${this.errMsg(err)}`, {
                path
            })
        }
    }

    private async childDirectories(path: string): Promise<ServerDirectoryEntry[]> {
        let entries
        try {
            entries = await readdir(path, { encoding: 'utf8', withFileTypes: true })
        } catch (err) {
            throw BusinessException.badRequest(`Cannot read directory: ${this.errMsg(err)}`, {
                path
            })
        }

        const directories: ServerDirectoryEntry[] = []
        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const child = join(path, entry.name)
            directories.push({
                name: entry.name,
                path: child,
                readable: await this.canReadDirectory(child)
            })
        }

        return directories.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        )
    }

    private async canReadDirectory(path: string): Promise<boolean> {
        try {
            await access(path, constants.R_OK | constants.X_OK)
            return true
        } catch {
            return false
        }
    }

    private findRequestedKind(
        rawPath: string,
        roots: ResolvedRoot[]
    ): NonNullable<ServerDirectoryRoot['kind']> {
        const normalized = this.userWorkspace.normalizeUserPath(rawPath)
        const root = this.findContainingRoot(normalized, roots)
        if (root?.kind) return root.kind
        throw BusinessException.forbidden('Directory is outside current user workspace roots', {
            path: normalized,
            roots: roots.map((r) => r.path)
        })
    }

    private parseImportPayload(buffer: Buffer): ImportLocalSkillFolderPayload {
        let parsed: unknown
        try {
            parsed = JSON.parse(buffer.toString('utf8'))
        } catch {
            throw BusinessException.badRequest('Local skill folder manifest must be valid JSON')
        }

        if (typeof parsed !== 'object' || parsed === null) {
            throw BusinessException.badRequest('Local skill folder manifest must be an object')
        }
        const payload = parsed as Partial<ImportLocalSkillFolderPayload>
        if (typeof payload.folderName !== 'string' || !payload.folderName.trim()) {
            throw BusinessException.badRequest('Local skill folder name is required')
        }
        if (!Array.isArray(payload.files)) {
            throw BusinessException.badRequest('Local skill folder files must be an array')
        }
        return {
            folderName: payload.folderName,
            files: payload.files
        }
    }

    private normalizeImportFiles(files: unknown[]): LocalSkillFolderFile[] {
        if (files.length === 0) {
            throw BusinessException.badRequest('Local skill folder must contain files')
        }
        if (files.length > MAX_LOCAL_SKILL_IMPORT_FILES) {
            throw BusinessException.badRequest('Local skill folder contains too many files', {
                maxFiles: MAX_LOCAL_SKILL_IMPORT_FILES,
                count: files.length
            })
        }

        const seen = new Set<string>()
        let totalSize = 0
        return files.map((item) => {
            if (typeof item !== 'object' || item === null) {
                throw BusinessException.badRequest('Local skill folder file entry must be an object')
            }
            const file = item as Partial<LocalSkillFolderFile>
            if (typeof file.relativePath !== 'string' || !file.relativePath.trim()) {
                throw BusinessException.badRequest('Local skill folder file path is required')
            }
            const relativePath = this.normalizeRelativeFilePath(file.relativePath)
            if (seen.has(relativePath)) {
                throw BusinessException.badRequest('Duplicate local skill folder file path', {
                    relativePath
                })
            }
            seen.add(relativePath)

            if (typeof file.contentBase64 !== 'string') {
                throw BusinessException.badRequest('Local skill folder file content is required', {
                    relativePath
                })
            }
            const contentBase64 = file.contentBase64
            if (contentBase64 !== '' && !BASE64_RE.test(contentBase64)) {
                throw BusinessException.badRequest('Local skill folder file content must be base64', {
                    relativePath
                })
            }
            const size = file.size
            if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
                throw BusinessException.badRequest('Local skill folder file size is invalid', {
                    relativePath
                })
            }
            if (size > MAX_LOCAL_SKILL_IMPORT_FILE_BYTES) {
                throw BusinessException.badRequest('Local skill folder file is too large', {
                    relativePath,
                    maxBytes: MAX_LOCAL_SKILL_IMPORT_FILE_BYTES,
                    size
                })
            }
            const decodedSize = Buffer.from(contentBase64, 'base64').length
            if (decodedSize !== size) {
                throw BusinessException.badRequest('Local skill folder file size does not match', {
                    relativePath,
                    size,
                    decodedSize
                })
            }
            totalSize += decodedSize
            if (totalSize > MAX_LOCAL_SKILL_IMPORT_BYTES) {
                throw BusinessException.badRequest('Local skill folder is too large', {
                    maxBytes: MAX_LOCAL_SKILL_IMPORT_BYTES,
                    size: totalSize
                })
            }

            return {
                relativePath,
                contentBase64,
                size
            }
        })
    }

    private normalizeRelativeFilePath(path: string): string {
        const normalized = path.trim().replace(/\\/g, '/')
        if (
            !normalized ||
            normalized.startsWith('/') ||
            /^[A-Za-z]:\//.test(normalized) ||
            normalized.includes('\0')
        ) {
            throw BusinessException.forbidden('Local skill folder file path is invalid', { path })
        }
        const parts = normalized.split('/')
        if (parts.some((part) => !part || part === '.' || part === '..')) {
            throw BusinessException.forbidden(
                'Local skill folder file path cannot contain traversal',
                { path }
            )
        }
        return parts.join('/')
    }

    private safeFolderName(folderName: string): string {
        const safe = folderName
            .trim()
            .replace(/[/\\]+/g, '-')
            .replace(/[^A-Za-z0-9._-]+/g, '-')
            .replace(/^[._-]+|[._-]+$/g, '')
            .slice(0, 64)
        return safe || 'local-skill'
    }

    private async allocateImportDirectory(skillsRoot: string, folderName: string): Promise<string> {
        await mkdir(skillsRoot, { recursive: true })
        for (let i = 0; i < 1000; i += 1) {
            const name = i === 0 ? folderName : `${folderName}-${i + 1}`
            const directory = resolve(skillsRoot, name)
            if (!this.userWorkspace.isInsideRoot(directory, skillsRoot)) {
                throw BusinessException.forbidden('Skill import directory escapes skills root', {
                    directory,
                    skillsRoot
                })
            }
            try {
                await mkdir(directory)
                return directory
            } catch (err) {
                if (this.errCode(err) === 'EEXIST') continue
                throw BusinessException.badRequest(
                    `Cannot create skill import directory: ${this.errMsg(err)}`,
                    { directory }
                )
            }
        }
        throw BusinessException.conflict('Too many imported skill folders with the same name', {
            folderName
        })
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }

    private errCode(err: unknown): string | undefined {
        return typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : undefined
    }
}
