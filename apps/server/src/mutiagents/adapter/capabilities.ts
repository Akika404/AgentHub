import type { AgentCapabilities, AgentVendor } from './types.js'

/**
 * 各 vendor 的能力描述符（单一事实来源）。
 *
 * adapter 实例的 capabilities() 与上层（不构造 adapter 的列表视图）都从这里取，
 * 避免两处各写一份导致漂移。
 */
export const CLAUDE_CAPABILITIES: AgentCapabilities = {
    supportsSystemPrompt: true,
    supportsSkills: true,
    supportsMcp: true,
    supportsResumeById: true
}

export const CODEX_CAPABILITIES: AgentCapabilities = {
    // Codex ThreadOptions 无 systemPrompt 字段，但 CodexOptions.config.instructions
    // 会被 core 映射成 base_instructions，因此可支持 Agent 级 systemPrompt。
    supportsSystemPrompt: true,
    // MCP 配置形态与统一接口(Claude 形状)不同且未做翻译；skills 也无对等概念。
    // 这两项仍声明不支持，由上层在创建时显式拦截而非静默丢弃。
    supportsSkills: false,
    supportsMcp: false,
    supportsResumeById: true
}

/** 按 vendor 取能力描述符，无需构造 adapter 实例 */
export function getCapabilities(vendor: AgentVendor): AgentCapabilities {
    return vendor === 'claude' ? CLAUDE_CAPABILITIES : CODEX_CAPABILITIES
}
