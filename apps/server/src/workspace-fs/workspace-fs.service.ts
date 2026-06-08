import { Injectable, Logger } from '@nestjs/common'
import { access, readdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
    ServerDirectoryEntry,
    ServerDirectoryListing,
    ServerDirectoryRoot
} from '@agenthub/shared'
import { BusinessException } from '../common/index.js'
import { UserWorkspaceService } from '../user-workspace/user-workspace.service.js'

interface ResolvedRoot extends ServerDirectoryRoot {
    path: string
}

@Injectable()
export class WorkspaceFsService {
    private readonly logger = new Logger(WorkspaceFsService.name)

    constructor(private readonly userWorkspace: UserWorkspaceService) {}

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

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
