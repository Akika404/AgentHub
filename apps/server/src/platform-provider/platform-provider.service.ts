import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { BusinessException } from '../common/index.js'
import { PlatformProvider, type ProviderType } from './entities/platform-provider.entity.js'
import { CreatePlatformProviderDto } from './dto/create-platform-provider.dto.js'
import { UpdatePlatformProviderDto } from './dto/update-platform-provider.dto.js'
import type { PlatformProviderView, ProviderTestResult } from './dto/platform-provider-view.dto.js'
import { toPlatformProviderView } from './mappers/platform-provider.mapper.js'
import { ProviderProbeService } from './provider-probe.service.js'

/**
 * Provider 的运行时凭证：含**明文 apiKey**，仅供后端内部（如 AgentManager 重建 adapter）使用，
 * 绝不经控制器对外返回。
 */
export interface ProviderRuntimeConfig {
    type: ProviderType
    baseUrl: string
    apiKey: string
    modelList: string[]
}

/**
 * PlatformProviderService —— 用户自建 Provider 的全部业务逻辑与 DB 访问。
 *
 * 所有方法都以 userId 做数据隔离：非本人的记录一律按「不存在」处理（NOT_FOUND），
 * 不泄露其存在性。apiKey 列 select:false，需要密钥的操作（视图掩码、探测上游）显式
 * addSelect 取出，且绝不把明文回给客户端（见 mapper）。
 */
@Injectable()
export class PlatformProviderService {
    constructor(
        @InjectRepository(PlatformProvider)
        private readonly providerRepo: Repository<PlatformProvider>,
        private readonly probe: ProviderProbeService
    ) {}

    /** 添加 Provider：同一用户下 platformName 唯一。 */
    async create(userId: string, dto: CreatePlatformProviderDto): Promise<PlatformProviderView> {
        await this.assertNameAvailable(userId, dto.platformName)
        const entity = this.providerRepo.create({
            userId,
            platformName: dto.platformName,
            type: dto.type,
            baseUrl: dto.baseUrl,
            apiKey: dto.apiKey,
            modelList: dto.modelList ?? []
        })
        const saved = await this.providerRepo.save(entity)
        return toPlatformProviderView(saved)
    }

    /** 列出当前用户的全部 Provider（含 apiKey 以便掩码，按创建时间倒序）。 */
    async list(userId: string): Promise<PlatformProviderView[]> {
        const rows = await this.providerRepo
            .createQueryBuilder('p')
            .addSelect('p.apiKey')
            .where('p.userId = :userId', { userId })
            .orderBy('p.createdAt', 'DESC')
            .getMany()
        return rows.map(toPlatformProviderView)
    }

    /** 查单个 Provider 详情。 */
    async get(userId: string, id: string): Promise<PlatformProviderView> {
        const entity = await this.findOwned(userId, id)
        return toPlatformProviderView(entity)
    }

    /** 修改 Provider：部分更新，只覆盖传入字段；apiKey 省略则保留原值。 */
    async update(
        userId: string,
        id: string,
        dto: UpdatePlatformProviderDto
    ): Promise<PlatformProviderView> {
        const entity = await this.findOwned(userId, id)

        if (dto.platformName !== undefined && dto.platformName !== entity.platformName) {
            await this.assertNameAvailable(userId, dto.platformName)
            entity.platformName = dto.platformName
        }
        if (dto.type !== undefined) entity.type = dto.type
        if (dto.baseUrl !== undefined) entity.baseUrl = dto.baseUrl
        if (dto.apiKey !== undefined) entity.apiKey = dto.apiKey
        if (dto.modelList !== undefined) entity.modelList = dto.modelList

        const saved = await this.providerRepo.save(entity)
        return toPlatformProviderView(saved)
    }

    /** 删除 Provider（硬删除）。 */
    async remove(userId: string, id: string): Promise<{ deleted: true }> {
        const entity = await this.findOwned(userId, id)
        await this.providerRepo.remove(entity)
        return { deleted: true }
    }

    /** 测试连接：用已存的配置打一次上游列模型接口。失败返回 ok:false 而非抛错。 */
    async test(userId: string, id: string): Promise<ProviderTestResult> {
        const entity = await this.findOwned(userId, id)
        return this.probe.test(entity.type, entity.baseUrl, entity.apiKey)
    }

    /** 拉取上游可用模型并整体覆盖 modelList，返回更新后的视图。上游不可达时抛 UPSTREAM_ERROR。 */
    async refreshModels(userId: string, id: string): Promise<PlatformProviderView> {
        const entity = await this.findOwned(userId, id)
        entity.modelList = await this.probe.listModels(entity.type, entity.baseUrl, entity.apiKey)
        const saved = await this.providerRepo.save(entity)
        return toPlatformProviderView(saved)
    }

    /**
     * 按 (userId, id) 取运行时凭证（含明文 apiKey），供其他后端模块（AgentManager）重建 adapter。
     * 不存在或非本人 → NOT_FOUND。**绝不**把返回值经控制器对外暴露。
     */
    async resolveRuntimeConfig(userId: string, id: string): Promise<ProviderRuntimeConfig> {
        const entity = await this.findOwned(userId, id)
        return {
            type: entity.type,
            baseUrl: entity.baseUrl,
            apiKey: entity.apiKey,
            modelList: entity.modelList
        }
    }

    /**
     * 按 (userId, id) 取本人记录，并 addSelect 取出 apiKey（用于掩码 / 探测）。
     * 不存在或非本人 → NOT_FOUND。
     */
    private async findOwned(userId: string, id: string): Promise<PlatformProvider> {
        const entity = await this.providerRepo
            .createQueryBuilder('p')
            .addSelect('p.apiKey')
            .where('p.id = :id', { id })
            .andWhere('p.userId = :userId', { userId })
            .getOne()
        if (!entity) {
            throw BusinessException.notFound('Provider 不存在')
        }
        return entity
    }

    /** 校验同一用户下 platformName 未被占用，已占用则 CONFLICT。 */
    private async assertNameAvailable(userId: string, platformName: string): Promise<void> {
        const existing = await this.providerRepo.findOne({
            where: { userId, platformName }
        })
        if (existing) {
            throw BusinessException.conflict('同名 Provider 已存在')
        }
    }
}
