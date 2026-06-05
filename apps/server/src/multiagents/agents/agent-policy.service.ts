import { Injectable } from '@nestjs/common'
import { BusinessException } from '../../common/index.js'
import { getCapabilities, type AgentVendor } from '../adapter/index.js'
import type { CreateAgentChatDto } from '../dto/create-agent-chat.dto.js'
import type { ProviderType } from '../../platform-provider/entities/platform-provider.entity.js'

const DEFAULT_AGENT_COLOR = '#3370ff'
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export type AgentSkillsInput = 'all' | string[] | null | undefined

@Injectable()
export class AgentPolicyService {
    normalizeTitle(title: string | undefined): string | null {
        const trimmed = title?.trim() ?? ''
        if (!trimmed) return null
        if (trimmed.length > 128) {
            throw BusinessException.badRequest('Chat title cannot exceed 128 characters')
        }
        return trimmed
    }

    normalizeNullableText(value: string | null | undefined, fallback: string | null): string | null {
        if (value === undefined) return fallback
        if (value === null) return null
        return value.trim() ? value : null
    }

    normalizeColor(color: string | undefined): string {
        const trimmed = color?.trim() ?? DEFAULT_AGENT_COLOR
        if (!HEX_COLOR_RE.test(trimmed)) {
            throw BusinessException.badRequest('Agent color must be a hex color like #3370ff')
        }
        return trimmed.toLowerCase()
    }

    assertSkillsShape(skills: AgentSkillsInput): void {
        if (skills === undefined) return
        if (skills === null) return
        if (skills === 'all') return
        if (Array.isArray(skills) && skills.every((s) => typeof s === 'string')) return
        throw BusinessException.badRequest('skills must be "all" or an array of skill names')
    }

    mergeSkills(requested: AgentSkillsInput, importedSkillNames: string[]): 'all' | string[] | null {
        if (requested === 'all') return 'all'
        const names = new Set<string>()
        if (Array.isArray(requested)) {
            for (const name of requested) {
                const trimmed = name.trim()
                if (trimmed) names.add(trimmed)
            }
        }
        for (const name of importedSkillNames) names.add(name)
        return names.size > 0 ? [...names] : null
    }

    mergeMcpServers(
        base: Record<string, unknown> | null,
        override: Record<string, unknown> | undefined
    ): Record<string, unknown> | null {
        const merged = { ...(base ?? {}), ...(override ?? {}) }
        return Object.keys(merged).length > 0 ? merged : null
    }

    assertVendorProviderCompatible(vendor: AgentVendor, type: ProviderType): void {
        const compatible =
            vendor === 'claude'
                ? type === 'anthropic'
                : type === 'openai-responses' || type === 'openai-chat-completions'
        if (!compatible) {
            throw BusinessException.badRequest(
                `vendor "${vendor}" 与 Provider 类型 "${type}" 不兼容`,
                { vendor, providerType: type }
            )
        }
    }

    assertModelInList(model: string, modelList: string[]): void {
        if (modelList.length > 0 && !modelList.includes(model)) {
            throw BusinessException.badRequest(
                `model "${model}" 不在所引用 Provider 的 modelList 中`,
                { model, modelList }
            )
        }
    }

    assertConfigSupported(dto: {
        vendor: AgentVendor
        systemPrompt?: string | null
        skills?: AgentSkillsInput
        skillSourceDirectories?: string[]
        mcpServers?: Record<string, unknown> | null
    }): void {
        const caps = getCapabilities(dto.vendor)
        const unsupported: string[] = []
        if (dto.systemPrompt && !caps.supportsSystemPrompt) unsupported.push('systemPrompt')
        if (
            (dto.skills ||
                (dto.skillSourceDirectories !== undefined &&
                    dto.skillSourceDirectories.length > 0)) &&
            !caps.supportsSkills
        ) {
            unsupported.push('skills')
        }
        if (dto.mcpServers && !caps.supportsMcp) unsupported.push('mcpServers')
        if (unsupported.length > 0) {
            throw BusinessException.agentUnavailable(
                `Vendor "${dto.vendor}" does not support: ${unsupported.join(', ')}`,
                { vendor: dto.vendor, unsupported, capabilities: caps }
            )
        }
    }

    assertChatConfigSupported(vendor: AgentVendor, dto: CreateAgentChatDto): void {
        const caps = getCapabilities(vendor)
        const unsupported: string[] = []
        if ((dto.skillSourceDirectories?.length ?? 0) > 0 && !caps.supportsSkills) {
            unsupported.push('skills')
        }
        if (dto.mcpServers && Object.keys(dto.mcpServers).length > 0 && !caps.supportsMcp) {
            unsupported.push('mcpServers')
        }
        if (unsupported.length > 0) {
            throw BusinessException.agentUnavailable(
                `Vendor "${vendor}" does not support chat config: ${unsupported.join(', ')}`,
                { vendor, unsupported, capabilities: caps }
            )
        }
    }
}
