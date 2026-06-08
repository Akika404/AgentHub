import { Allow, IsArray, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator'

/**
 * 创建单 Agent 聊天。systemPrompt 不在这里设置，运行时沿用 Agent 配置。
 */
export class CreateAgentChatDto {
    @IsString()
    @IsNotEmpty()
    agentId!: string

    @IsOptional()
    @IsString()
    title?: string

    @IsOptional()
    @IsString()
    workingDirectory?: string

    /** 本聊天要导入的服务器 Skill 文件夹路径。是否支持取决于 vendor 能力。 */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    skillSourceDirectories?: string[]

    /** MCP 服务器配置。形状为联合/嵌套对象，用 @Allow 放行，由 Manager 校验 vendor 能力。 */
    @IsOptional()
    @IsObject()
    @Allow()
    mcpServers?: Record<string, unknown>
}
