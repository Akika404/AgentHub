import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ErrorCode } from '../common/exceptions/error-code.js'
import type { BusinessException } from '../common/index.js'
import { PlatformProvider, type ProviderType } from './entities/platform-provider.entity.js'
import { PlatformProviderService } from './platform-provider.service.js'
import type { ProviderProbeService } from './provider-probe.service.js'

const DEFAULT_TYPE: ProviderType = 'openai-responses'
const BASE_TIME = new Date('2026-01-01T00:00:00.000Z')

type ProviderCriteria = Partial<Pick<PlatformProvider, 'id' | 'userId' | 'platformName'>>
type ProviderPatch = Partial<Pick<PlatformProvider, 'isDefault' | 'defaultModel'>>

function cloneProvider(row: PlatformProvider): PlatformProvider {
    return Object.assign(new PlatformProvider(), {
        ...row,
        modelList: [...(row.modelList ?? [])],
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt)
    })
}

function matches(row: PlatformProvider, criteria: ProviderCriteria): boolean {
    return Object.entries(criteria).every(([key, value]) => {
        return row[key as keyof ProviderCriteria] === value
    })
}

function sortable(value: unknown): number | string {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'boolean') return value ? 1 : 0
    if (typeof value === 'number' || typeof value === 'string') return value
    return JSON.stringify(value)
}

class FakeProviderQueryBuilder {
    private filters: Array<(row: PlatformProvider) => boolean> = []
    private orders: Array<{ field: keyof PlatformProvider; direction: 'ASC' | 'DESC' }> = []

    constructor(private readonly repo: FakeProviderRepository) {}

    addSelect(): this {
        return this
    }

    where(expression: string, params: Record<string, unknown>): this {
        this.filters = []
        return this.andWhere(expression, params)
    }

    andWhere(expression: string, params: Record<string, unknown>): this {
        const match = /^p\.(\w+) = :(\w+)$/.exec(expression)
        if (!match) {
            throw new Error(`Unsupported fake query expression: ${expression}`)
        }
        const field = match[1] as keyof PlatformProvider
        const param = match[2]
        const expected = params[param]
        this.filters.push((row) => row[field] === expected)
        return this
    }

    orderBy(fieldExpression: string, direction: 'ASC' | 'DESC'): this {
        this.orders = []
        return this.addOrderBy(fieldExpression, direction)
    }

    addOrderBy(fieldExpression: string, direction: 'ASC' | 'DESC'): this {
        const match = /^p\.(\w+)$/.exec(fieldExpression)
        if (!match) {
            throw new Error(`Unsupported fake order expression: ${fieldExpression}`)
        }
        this.orders.push({ field: match[1] as keyof PlatformProvider, direction })
        return this
    }

    async getOne(): Promise<PlatformProvider | null> {
        return this.apply()[0] ?? null
    }

    async getMany(): Promise<PlatformProvider[]> {
        return this.apply()
    }

    private apply(): PlatformProvider[] {
        const rows = this.repo.rows().filter((row) => this.filters.every((filter) => filter(row)))
        rows.sort((a, b) => {
            for (const order of this.orders) {
                const aValue = sortable(a[order.field])
                const bValue = sortable(b[order.field])
                if (aValue === bValue) continue
                const result = aValue > bValue ? 1 : -1
                return order.direction === 'ASC' ? result : -result
            }
            return 0
        })
        return rows.map(cloneProvider)
    }
}

class FakeProviderRepository {
    private readonly store = new Map<string, PlatformProvider>()
    private nextId = 1
    private nextTime = 1
    transactionCount = 0

    readonly manager = {
        transaction: async <T>(work: (manager: { getRepository: () => FakeProviderRepository }) => T) => {
            this.transactionCount += 1
            return work({ getRepository: () => this })
        }
    }

    create(partial: Partial<PlatformProvider>): PlatformProvider {
        return Object.assign(new PlatformProvider(), {
            id: '',
            userId: '',
            platformName: '',
            type: DEFAULT_TYPE,
            baseUrl: '',
            apiKey: '',
            modelList: [],
            isDefault: false,
            defaultModel: null,
            createdAt: BASE_TIME,
            updatedAt: BASE_TIME,
            ...partial
        })
    }

    async save(entity: PlatformProvider): Promise<PlatformProvider> {
        const saved = cloneProvider(entity)
        if (!saved.id) saved.id = `provider-${this.nextId++}`
        if (!saved.createdAt) saved.createdAt = this.tick()
        saved.updatedAt = this.tick()
        this.store.set(saved.id, cloneProvider(saved))
        return cloneProvider(saved)
    }

    async update(criteria: ProviderCriteria, patch: ProviderPatch): Promise<void> {
        for (const row of this.store.values()) {
            if (!matches(row, criteria)) continue
            Object.assign(row, patch, { updatedAt: this.tick() })
        }
    }

    async findOne(options: { where: ProviderCriteria }): Promise<PlatformProvider | null> {
        const row = this.rows().find((item) => matches(item, options.where))
        return row ? cloneProvider(row) : null
    }

    async remove(entity: PlatformProvider): Promise<PlatformProvider> {
        this.store.delete(entity.id)
        return cloneProvider(entity)
    }

    createQueryBuilder(): FakeProviderQueryBuilder {
        return new FakeProviderQueryBuilder(this)
    }

    rows(): PlatformProvider[] {
        return Array.from(this.store.values()).map(cloneProvider)
    }

    get(id: string): PlatformProvider | undefined {
        const row = this.store.get(id)
        return row ? cloneProvider(row) : undefined
    }

    private tick(): Date {
        return new Date(BASE_TIME.getTime() + this.nextTime++ * 1000)
    }
}

class FakeProbeService implements Pick<ProviderProbeService, 'listModels' | 'test'> {
    models: string[] = []

    async listModels(): Promise<string[]> {
        return [...this.models]
    }

    async test(): Promise<{ ok: true; latencyMs: number; modelCount: number }> {
        return { ok: true, latencyMs: 1, modelCount: this.models.length }
    }
}

function createSubject(): {
    service: PlatformProviderService
    repo: FakeProviderRepository
    probe: FakeProbeService
} {
    const repo = new FakeProviderRepository()
    const probe = new FakeProbeService()
    const service = new PlatformProviderService(repo as never, probe as never)
    return { service, repo, probe }
}

function providerPayload(overrides: {
    platformName: string
    apiKey?: string
    modelList?: string[]
    isDefault?: boolean
    defaultModel?: string | null
}) {
    return {
        platformName: overrides.platformName,
        type: DEFAULT_TYPE,
        baseUrl: 'https://api.example.com/v1',
        apiKey: overrides.apiKey ?? `sk-${overrides.platformName}`,
        modelList: overrides.modelList ?? ['gpt-4.1'],
        isDefault: overrides.isDefault,
        defaultModel: overrides.defaultModel
    }
}

function expectBusinessCode(code: ErrorCode): (err: unknown) => boolean {
    return (err) => {
        assert.equal((err as BusinessException).code, code)
        return true
    }
}

test('PlatformProviderService clears old user default when creating a new default provider', async () => {
    const { service, repo } = createSubject()

    const first = await service.create(
        'user-1',
        providerPayload({
            platformName: 'old-default',
            modelList: ['old-model'],
            isDefault: true,
            defaultModel: 'old-model'
        })
    )
    const second = await service.create(
        'user-1',
        providerPayload({
            platformName: 'new-default',
            modelList: ['new-model'],
            isDefault: true,
            defaultModel: 'new-model'
        })
    )

    assert.equal(repo.transactionCount, 2)
    assert.equal(repo.get(first.id)?.isDefault, false)
    assert.equal(repo.get(first.id)?.defaultModel, null)
    assert.equal(repo.get(second.id)?.isDefault, true)
    assert.equal(repo.get(second.id)?.defaultModel, 'new-model')
})

test('PlatformProviderService rejects default model missing from a non-empty model list', async () => {
    const { service } = createSubject()

    await assert.rejects(
        () =>
            service.create(
                'user-1',
                providerPayload({
                    platformName: 'bad-default',
                    modelList: ['gpt-4.1'],
                    isDefault: true,
                    defaultModel: 'claude-sonnet-4.5'
                })
            ),
        expectBusinessCode(ErrorCode.BAD_REQUEST)
    )
})

test('PlatformProviderService rejects updates that invalidate the existing default model', async () => {
    const { service, repo } = createSubject()
    const provider = await service.create(
        'user-1',
        providerPayload({
            platformName: 'default-provider',
            modelList: ['gpt-4.1'],
            isDefault: true,
            defaultModel: 'gpt-4.1'
        })
    )

    await assert.rejects(
        () => service.update('user-1', provider.id, { modelList: ['gpt-5.1'] }),
        expectBusinessCode(ErrorCode.BAD_REQUEST)
    )

    assert.deepEqual(repo.get(provider.id)?.modelList, ['gpt-4.1'])
    assert.equal(repo.get(provider.id)?.defaultModel, 'gpt-4.1')
})

test('PlatformProviderService leaves no default provider after deleting the default', async () => {
    const { service } = createSubject()
    const provider = await service.create(
        'user-1',
        providerPayload({
            platformName: 'default-provider',
            modelList: ['gpt-4.1'],
            isDefault: true,
            defaultModel: 'gpt-4.1'
        })
    )

    await service.remove('user-1', provider.id)

    const providers = await service.list('user-1')
    assert.equal(providers.some((item) => item.isDefault), false)
    await assert.rejects(
        () => service.resolveDefaultRuntimeConfig('user-1'),
        expectBusinessCode(ErrorCode.NOT_FOUND)
    )
})

test('PlatformProviderService resolves default runtime config with user isolation', async () => {
    const { service } = createSubject()
    const userOneProvider = await service.create(
        'user-1',
        providerPayload({
            platformName: 'user-one-default',
            apiKey: 'sk-user-one',
            modelList: ['gpt-4.1'],
            isDefault: true,
            defaultModel: 'gpt-4.1'
        })
    )
    await service.create(
        'user-2',
        providerPayload({
            platformName: 'user-two-default',
            apiKey: 'sk-user-two',
            modelList: ['claude-sonnet-4.5'],
            isDefault: true,
            defaultModel: 'claude-sonnet-4.5'
        })
    )

    const config = await service.resolveDefaultRuntimeConfig('user-1')

    assert.equal(config.providerId, userOneProvider.id)
    assert.equal(config.type, DEFAULT_TYPE)
    assert.equal(config.baseUrl, 'https://api.example.com/v1')
    assert.equal(config.apiKey, 'sk-user-one')
    assert.deepEqual(config.modelList, ['gpt-4.1'])
    assert.equal(config.model, 'gpt-4.1')
})

