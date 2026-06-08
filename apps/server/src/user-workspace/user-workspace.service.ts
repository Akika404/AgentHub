import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ServerDirectoryRoot, ServerDirectoryRootKind } from '@agenthub/shared'
import { BusinessException } from '../common/index.js'

export type UserWorkspaceKind = ServerDirectoryRootKind

interface UserWorkspacePaths {
    userRoot: string
    skillsRoot: string
    sessionRoot: string
    agentHomeRoot: string
    agentWorkspaceRoot: string
}

interface UserWorkspaceRoot extends ServerDirectoryRoot {
    kind: UserWorkspaceKind
}

const USER_WORKSPACE_KINDS: UserWorkspaceKind[] = [
    'skills',
    'agent_home',
    'agent_workspace'
]

@Injectable()
export class UserWorkspaceService {
    constructor(private readonly config: ConfigService) {}

    async browsableRoots(userId: string): Promise<UserWorkspaceRoot[]> {
        const paths = await this.ensureUserWorkspace(userId)
        return USER_WORKSPACE_KINDS.map((kind) => {
            const path = this.rootForKind(paths, kind)
            return {
                id: path,
                path,
                label: this.labelForKind(kind),
                kind
            }
        })
    }

    async ensureUserWorkspace(userId: string): Promise<UserWorkspacePaths> {
        this.assertSafeUserId(userId)
        const root = this.baseRoot()
        try {
            await mkdir(root, { recursive: true })
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare user workspace root: ${this.errMsg(err)}`,
                { userId, root }
            )
        }
        const resolvedRoot = await realpath(root)
        const userRoot = join(root, userId)
        const planned = {
            userRoot,
            skillsRoot: join(userRoot, 'skills'),
            sessionRoot: join(userRoot, 'session'),
            agentHomeRoot: join(userRoot, 'agent_home'),
            agentWorkspaceRoot: join(userRoot, 'agent_workspace')
        }

        try {
            await mkdir(planned.userRoot, { recursive: true })
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare user workspace: ${this.errMsg(err)}`,
                { userId, root }
            )
        }

        const expectedUserRoot = join(resolvedRoot, userId)
        const resolvedUserRoot = await realpath(planned.userRoot)
        if (resolvedUserRoot !== expectedUserRoot) {
            throw BusinessException.forbidden(
                'User workspace directory escapes the configured root',
                { userId, expectedUserRoot, userRoot: resolvedUserRoot }
            )
        }

        try {
            await mkdir(planned.skillsRoot, { recursive: true })
            await mkdir(planned.sessionRoot, { recursive: true })
            await mkdir(planned.agentHomeRoot, { recursive: true })
            await mkdir(planned.agentWorkspaceRoot, { recursive: true })
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare user workspace: ${this.errMsg(err)}`,
                { userId, root }
            )
        }

        const resolved = {
            userRoot: resolvedUserRoot,
            skillsRoot: await realpath(planned.skillsRoot),
            sessionRoot: await realpath(planned.sessionRoot),
            agentHomeRoot: await realpath(planned.agentHomeRoot),
            agentWorkspaceRoot: await realpath(planned.agentWorkspaceRoot)
        }

        const expectedRoots = [
            ['skillsRoot', resolved.skillsRoot, join(resolved.userRoot, 'skills')],
            ['sessionRoot', resolved.sessionRoot, join(resolved.userRoot, 'session')],
            ['agentHomeRoot', resolved.agentHomeRoot, join(resolved.userRoot, 'agent_home')],
            [
                'agentWorkspaceRoot',
                resolved.agentWorkspaceRoot,
                join(resolved.userRoot, 'agent_workspace')
            ]
        ] as const
        for (const [kind, path, expectedPath] of expectedRoots) {
            if (path !== expectedPath) {
                throw BusinessException.forbidden(
                    'User workspace directory does not match the expected user root layout',
                    { userId, kind, expectedPath, path }
                )
            }
        }

        return resolved
    }

    async assertPathInRoot(
        userId: string,
        kind: UserWorkspaceKind,
        rawPath: string,
        label = 'Directory path'
    ): Promise<string> {
        const paths = await this.ensureUserWorkspace(userId)
        const root = this.rootForKind(paths, kind)
        return this.resolvePathInsideRoot(rawPath, root, label)
    }

    async assertSkillSourceDirectories(
        userId: string,
        sourceDirectories: string[]
    ): Promise<string[]> {
        const paths: string[] = []
        for (const raw of sourceDirectories) {
            paths.push(
                await this.assertPathInRoot(
                    userId,
                    'skills',
                    raw,
                    'Skill source directory'
                )
            )
        }
        return paths
    }

    async allocateAgentHomeDirectory(userId: string, agentId: string): Promise<string> {
        const paths = await this.ensureUserWorkspace(userId)
        return join(paths.agentHomeRoot, agentId)
    }

    async allocateChatWorkspaceDirectory(userId: string, sessionId: string): Promise<string> {
        const paths = await this.ensureUserWorkspace(userId)
        return join(paths.agentWorkspaceRoot, `chat-${sessionId}`)
    }

    async allocateSessionHomeDirectory(userId: string, sessionId: string): Promise<string> {
        const paths = await this.ensureUserWorkspace(userId)
        return join(paths.sessionRoot, sessionId)
    }

    async allocateGroupWorkspaceDirectory(userId: string, groupId: string): Promise<string> {
        const paths = await this.ensureUserWorkspace(userId)
        return join(paths.agentWorkspaceRoot, `group-${groupId}`)
    }

    normalizeUserPath(rawPath: string): string {
        const trimmed = rawPath.trim()
        if (!trimmed) throw BusinessException.badRequest('Directory path cannot be empty')
        if (trimmed.split(/[\\/]+/).includes('..')) {
            throw BusinessException.forbidden('Directory path cannot contain parent traversal', {
                path: rawPath
            })
        }
        if (trimmed === '~') return homedir()
        if (trimmed.startsWith(`~${sep}`) || trimmed.startsWith('~/')) {
            return resolve(homedir(), trimmed.slice(2))
        }
        return resolve(trimmed)
    }

    findContainingRoot<T extends { path: string }>(
        path: string,
        roots: T[]
    ): T | null {
        const normalized = resolve(path)
        const sorted = [...roots].sort((a, b) => b.path.length - a.path.length)
        return sorted.find((root) => this.isInsideRoot(normalized, root.path)) ?? null
    }

    isInsideRoot(path: string, root: string): boolean {
        const rel = relative(root, path)
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    }

    private async resolvePathInsideRoot(
        rawPath: string,
        root: string,
        label: string
    ): Promise<string> {
        const normalized = this.normalizeUserPath(rawPath)
        const resolved = await this.resolveNearestExistingPath(normalized)
        if (!this.isInsideRoot(resolved, root)) {
            throw BusinessException.forbidden(`${label} is outside the current user's workspace`, {
                path: resolved,
                root
            })
        }
        return resolved
    }

    private async resolveNearestExistingPath(path: string): Promise<string> {
        const existing = await this.nearestExistingPath(path)
        const realExisting = await realpath(existing)
        const rel = relative(existing, path)
        return rel ? resolve(realExisting, rel) : realExisting
    }

    private async nearestExistingPath(path: string): Promise<string> {
        let current = resolve(path)
        while (true) {
            try {
                const info = await stat(current)
                if (!info.isDirectory()) {
                    throw BusinessException.badRequest('Path is not a directory', {
                        path: current
                    })
                }
                return current
            } catch (err) {
                if (err instanceof BusinessException) throw err
                if (this.errCode(err) !== 'ENOENT') {
                    throw BusinessException.badRequest(
                        `Directory is not available: ${this.errMsg(err)}`,
                        { path: current }
                    )
                }
                const parent = dirname(current)
                if (parent === current) {
                    throw BusinessException.badRequest('Directory path cannot be resolved', {
                        path
                    })
                }
                current = parent
            }
        }
    }

    private rootForKind(paths: UserWorkspacePaths, kind: UserWorkspaceKind): string {
        switch (kind) {
            case 'skills':
                return paths.skillsRoot
            case 'agent_home':
                return paths.agentHomeRoot
            case 'agent_workspace':
                return paths.agentWorkspaceRoot
        }
    }

    private labelForKind(kind: UserWorkspaceKind): string {
        switch (kind) {
            case 'skills':
                return 'Skills'
            case 'agent_home':
                return 'Agent Home'
            case 'agent_workspace':
                return 'Agent Workspace'
        }
    }

    private baseRoot(): string {
        const configured = this.config.get<string>('AGENTHUB_USER_SPACE_ROOT')?.trim()
        if (configured) return resolve(configured)
        return resolve(join(homedir(), '.agenthub', 'users'))
    }

    private assertSafeUserId(userId: string): void {
        if (!/^[A-Za-z0-9._-]+$/.test(userId) || userId === '.' || userId === '..') {
            throw BusinessException.badRequest('Invalid user id for workspace path', { userId })
        }
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
