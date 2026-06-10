import { strict as assert } from 'node:assert'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import { LOCAL_DEFAULT_MODEL } from '@agenthub/shared'
import { ErrorCode } from '../common/index.js'
import type { ProviderType } from '../platform-provider/entities/platform-provider.entity.js'
import { UserWorkspaceService } from '../user-workspace/user-workspace.service.js'
import type { Agent } from './entities/agent.entity.js'
import { AgentPolicyService } from './agents/agent-policy.service.js'
import { AgentConfigService } from './agents/agent-config.service.js'
import { AgentChatService } from './chats/agent-chat.service.js'
import { GroupChatService } from './group/group-chat.service.js'

const NOW = new Date('2026-01-01T00:00:00.000Z')

function userWorkspaceFor(root: string): UserWorkspaceService {
    return new UserWorkspaceService(new ConfigService({ AGENTHUB_USER_SPACE_ROOT: root }))
}

function isForbidden(err: unknown): boolean {
    return (
        typeof err === 'object' && err !== null && 'code' in err && err.code === ErrorCode.FORBIDDEN
    )
}

function repo<T extends object>(options: Partial<Record<string, unknown>> = {}): T {
    let nextId = 1
    const base = {
        create: (value: unknown) => value,
        save: async (value: Record<string, unknown>) => {
            value.id ??= `saved-${nextId++}`
            value.createdAt ??= NOW
            value.updatedAt = NOW
            return value
        },
        find: async () => [],
        findOne: async () => null,
        exists: async () => false,
        update: async () => undefined,
        delete: async () => undefined,
        ...options
    }
    return base as T
}

function providerService(type: ProviderType = 'anthropic'): unknown {
    return {
        resolveRuntimeConfig: async () => ({
            type,
            modelList: ['model-1'],
            apiKey: 'test-key',
            baseUrl: 'https://example.test'
        })
    }
}

function vendorSkillsRoot(base: string, vendor: 'claude' | 'codex'): string {
    return join(base, vendor === 'claude' ? '.claude' : '.codex', 'skills')
}

function agent(userId: string, agentHomeDirectory: string, workingDirectory: string): Agent {
    return {
        id: 'agent-1',
        userId,
        name: 'Agent One',
        avatar: null,
        color: '#3370ff',
        capabilitySummary: null,
        vendor: 'claude',
        executionMode: 'server',
        platformProviderId: 'provider-1',
        model: 'model-1',
        agentHomeDirectory,
        workingDirectory,
        systemPrompt: null,
        skills: null,
        mcpServers: null,
        allowedTools: null,
        permissionMode: null,
        reasoningEffort: null,
        createdAt: NOW,
        updatedAt: NOW
    }
}

test('AgentConfigService creates agents only inside the current user roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-service-space-'))
    const userWorkspace = userWorkspaceFor(root)
    const userA = await userWorkspace.ensureUserWorkspace('user-a')
    const userB = await userWorkspace.ensureUserWorkspace('user-b')
    const policy = new AgentPolicyService()
    const calls: { runtime?: unknown[] } = {}
    const workspace = {
        ensureRuntimeDirectories: async (...args: unknown[]) => {
            calls.runtime = args
        },
        vendorSkillsRoot,
        importSkillSourceDirectories: async () => []
    }
    const service = new AgentConfigService(
        repo(),
        repo(),
        providerService() as never,
        policy,
        workspace as never,
        userWorkspace,
        { assertNotBusy: () => undefined, evictSessions: () => undefined } as never,
        { deleteChatHistory: async () => undefined } as never
    )

    const view = await service.createAgent('user-a', {
        name: 'A',
        color: '#3370ff',
        capabilitySummary: '负责测试工作区隔离。',
        vendor: 'claude',
        platformProviderId: 'provider-1',
        model: 'model-1',
        workingDirectory: join(userA.agentWorkspaceRoot, 'project-a')
    })

    assert.equal(view.workingDirectory, join(userA.agentWorkspaceRoot, 'project-a'))
    assert.equal(view.agentHomeDirectory, join(userA.agentHomeRoot, view.id))
    assert.deepEqual(calls.runtime, [
        'claude',
        join(userA.agentWorkspaceRoot, 'project-a'),
        join(userA.agentHomeRoot, view.id)
    ])

    await assert.rejects(
        () =>
            service.createAgent('user-a', {
                name: 'A',
                color: '#3370ff',
                capabilitySummary: '负责测试工作区隔离。',
                vendor: 'claude',
                platformProviderId: 'provider-1',
                model: 'model-1',
                workingDirectory: join(userB.agentWorkspaceRoot, 'project-b')
            }),
        isForbidden
    )

    await assert.rejects(
        () =>
            service.createAgent('user-a', {
                name: 'A',
                color: '#3370ff',
                capabilitySummary: '   ',
                vendor: 'claude',
                platformProviderId: 'provider-1',
                model: 'model-1',
                workingDirectory: join(userA.agentWorkspaceRoot, 'project-a')
            }),
        (err) =>
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            err.code === ErrorCode.BAD_REQUEST
    )
})

test('AgentChatService allocates chat workspace and session home in the user space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-service-space-'))
    const userWorkspace = userWorkspaceFor(root)
    const userA = await userWorkspace.ensureUserWorkspace('user-a')
    const userB = await userWorkspace.ensureUserWorkspace('user-b')
    const loadedAgent = agent(
        'user-a',
        join(userA.agentHomeRoot, 'agent-1'),
        join(userA.agentWorkspaceRoot, 'agent-default')
    )
    const calls: { chatRuntime?: unknown[] } = {}
    const workspace = {
        ensureAgentHomeDirectory: async () => undefined,
        ensureChatRuntimeDirectories: async (...args: unknown[]) => {
            calls.chatRuntime = args
        },
        syncVendorConfigToWorkingDirectory: async () => undefined,
        vendorSkillsRoot,
        importSkillSourceDirectories: async () => []
    }
    const service = new AgentChatService(
        repo({ find: async () => [] }),
        repo(),
        repo({ find: async () => [] }),
        { loadAgent: async () => loadedAgent } as never,
        new AgentPolicyService(),
        workspace as never,
        {
            markCheckpoint: async () => undefined,
            summarize: async () => null,
            commit: async () => null
        } as never,
        userWorkspace,
        { getActiveTurns: async () => new Map(), getActiveTurn: async () => null } as never,
        { listChatMessages: async () => [], deleteChatHistory: async () => undefined } as never,
        { isConnected: () => false, rpc: async () => null } as never
    )

    const view = await service.createChat('user-a', { agentId: loadedAgent.id })

    assert.equal(view.workingDirectory, join(userA.agentWorkspaceRoot, `chat-${view.id}`))
    assert.equal(view.sessionHomeDirectory, join(userA.sessionRoot, view.id))
    assert.deepEqual(calls.chatRuntime, [
        'claude',
        join(userA.agentWorkspaceRoot, `chat-${view.id}`),
        join(userA.sessionRoot, view.id)
    ])

    await assert.rejects(
        () =>
            service.createChat('user-a', {
                agentId: loadedAgent.id,
                workingDirectory: join(userB.agentWorkspaceRoot, 'chat-b')
            }),
        isForbidden
    )
})

test('AgentChatService initializes local chats with checkpoint RPC, not commit RPC', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-service-space-'))
    const userWorkspace = userWorkspaceFor(root)
    const localAgent: Agent = {
        ...agent('user-a', '', '/Users/alice/project'),
        executionMode: 'local',
        platformProviderId: null,
        model: LOCAL_DEFAULT_MODEL
    }
    const rpcCalls: Array<{ method: string; params: unknown }> = []
    const service = new AgentChatService(
        repo({ find: async () => [] }),
        repo(),
        repo({ find: async () => [] }),
        { loadAgent: async () => localAgent } as never,
        new AgentPolicyService(),
        {} as never,
        {
            markCheckpoint: async () => undefined,
            summarize: async () => null,
            commit: async () => null
        } as never,
        userWorkspace,
        { getActiveTurns: async () => new Map(), getActiveTurn: async () => null } as never,
        { listChatMessages: async () => [], deleteChatHistory: async () => undefined } as never,
        {
            isConnected: () => true,
            rpc: async (_userId: string, method: string, params: unknown) => {
                rpcCalls.push({ method, params })
                return { ok: true }
            }
        } as never
    )

    const view = await service.createChat('user-a', { agentId: localAgent.id })

    assert.equal(view.workingDirectory, '/Users/alice/project')
    assert.deepEqual(
        rpcCalls.map((call) => call.method),
        ['dir.ensure', 'diff.checkpoint']
    )
    assert.equal(rpcCalls.some((call) => call.method === 'diff.commit'), false)
})

test('GroupChatService allocates group workspaces in the current user agent_workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-service-space-'))
    const userWorkspace = userWorkspaceFor(root)
    const userA = await userWorkspace.ensureUserWorkspace('user-a')
    const userB = await userWorkspace.ensureUserWorkspace('user-b')
    const memberAgent = agent(
        'user-a',
        join(userA.agentHomeRoot, 'agent-1'),
        join(userA.agentWorkspaceRoot, 'agent-default')
    )
    const calls: { createWorkspace?: unknown[]; deleted?: unknown } = {}
    const workspace = {
        createWorkspace: async (...args: unknown[]) => {
            calls.createWorkspace = args
            return args[1] as string
        },
        removeWorkspace: async () => undefined
    }
    const service = new GroupChatService(
        repo(),
        repo(),
        repo({ find: async () => [memberAgent] }),
        workspace as never,
        { markCheckpoint: async () => undefined } as never,
        userWorkspace,
        new AgentPolicyService(),
        providerService() as never,
        { getActiveRuns: async () => new Map(), getActiveRun: async () => null } as never,
        { transaction: async () => undefined } as never
    )

    const view = await service.createGroupChat('user-a', {
        title: 'Group',
        memberAgentIds: [memberAgent.id],
        orchestrator: {
            vendor: 'claude',
            model: 'model-1',
            providerId: 'provider-1'
        },
        projectMeta: { name: 'Project' }
    })

    assert.equal(view.workspaceDir, join(userA.agentWorkspaceRoot, `group-${view.id}`))
    assert.deepEqual(calls.createWorkspace, [
        view.id,
        join(userA.agentWorkspaceRoot, `group-${view.id}`)
    ])

    const rejectingService = new GroupChatService(
        repo({
            delete: async (criteria: unknown) => {
                calls.deleted = criteria
            }
        }),
        repo(),
        repo({ find: async () => [memberAgent] }),
        workspace as never,
        { markCheckpoint: async () => undefined } as never,
        userWorkspace,
        new AgentPolicyService(),
        providerService() as never,
        { getActiveRuns: async () => new Map(), getActiveRun: async () => null } as never,
        { transaction: async () => undefined } as never
    )
    await assert.rejects(
        () =>
            rejectingService.createGroupChat('user-a', {
                title: 'Group',
                memberAgentIds: [memberAgent.id],
                orchestrator: {
                    vendor: 'claude',
                    model: 'model-1',
                    providerId: 'provider-1'
                },
                projectMeta: { name: 'Project' },
                workspaceDir: join(userB.agentWorkspaceRoot, 'group-b')
            }),
        isForbidden
    )
    assert.ok(calls.deleted)
})
