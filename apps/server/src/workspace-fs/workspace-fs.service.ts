import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { access, mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import type {
    ServerDirectoryEntry,
    ServerDirectoryListing,
    ServerDirectoryRoot
} from '@agenthub/shared'
import { BusinessException } from '../common/index.js'

interface ResolvedRoot extends ServerDirectoryRoot {
    path: string
}

@Injectable()
export class WorkspaceFsService {
    private readonly logger = new Logger(WorkspaceFsService.name)

    constructor(private readonly config: ConfigService) {}

    async roots(): Promise<ServerDirectoryRoot[]> {
        return this.resolveRoots()
    }

    async listDirectories(rawPath?: string): Promise<ServerDirectoryListing> {
        const roots = await this.resolveRoots()
        if (roots.length === 0) {
            throw BusinessException.badRequest('No server workspace roots are available')
        }

        const requested = rawPath?.trim()
        const requestedPath = requested ? this.normalizePath(requested) : roots[0].path
        await this.assertReadableDirectory(requestedPath)
        const path = await realpath(requestedPath)
        const root = this.findContainingRoot(path, roots)
        if (!root) {
            throw BusinessException.forbidden('Directory is outside configured server roots', {
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

    private async resolveRoots(): Promise<ResolvedRoot[]> {
        const rawRoots = this.configuredRootPaths()
        const roots: ResolvedRoot[] = []
        const seen = new Set<string>()

        for (const raw of rawRoots) {
            const path = this.normalizePath(raw)

            try {
                await mkdir(path, { recursive: true })
                await this.assertReadableDirectory(path)
                const realRoot = await realpath(path)
                if (seen.has(realRoot)) continue
                seen.add(realRoot)
                roots.push({
                    id: realRoot,
                    path: realRoot,
                    label: this.rootLabel(realRoot)
                })
            } catch (err) {
                this.logger.warn(`Workspace root unavailable (${path}): ${this.errMsg(err)}`)
            }
        }

        return roots
    }

    private configuredRootPaths(): string[] {
        const configured = this.config.get<string>('AGENTHUB_WORKSPACE_ROOTS')?.trim()
        if (configured) {
            return configured
                .split(delimiter)
                .map((item) => item.trim())
                .filter(Boolean)
        }

        const groupRoot =
            this.config.get<string>('GROUP_WORKSPACE_ROOT')?.trim() ||
            join(homedir(), '.agenthub', 'groups')
        return [homedir(), groupRoot]
    }

    private normalizePath(path: string): string {
        const trimmed = path.trim()
        if (!trimmed) throw BusinessException.badRequest('Directory path cannot be empty')
        if (trimmed === '~') return homedir()
        if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
        return resolve(trimmed)
    }

    private findContainingRoot(path: string, roots: ResolvedRoot[]): ResolvedRoot | null {
        const normalized = resolve(path)
        const sorted = [...roots].sort((a, b) => b.path.length - a.path.length)
        return sorted.find((root) => this.isInsideRoot(normalized, root.path)) ?? null
    }

    private isInsideRoot(path: string, root: string): boolean {
        const rel = relative(root, path)
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }

    private parentInsideRoot(path: string, root: ResolvedRoot): string | null {
        if (resolve(path) === root.path) return null
        const parent = resolve(path, '..')
        return this.isInsideRoot(parent, root.path) ? parent : null
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

    private rootLabel(path: string): string {
        const home = homedir()
        if (path === home) return 'Home'
        const name = basename(path)
        return name || path
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
