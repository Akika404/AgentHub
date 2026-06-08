import { Injectable } from '@nestjs/common'
import { cp, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { BusinessException } from '../../common/index.js'
import type { AgentVendor } from '../adapter/index.js'

@Injectable()
export class AgentWorkspaceService {
    normalizeDirectoryPath(path: string): string {
        const trimmed = path.trim()
        if (!trimmed) throw BusinessException.badRequest('Directory path cannot be empty')
        if (trimmed === '~') return homedir()
        if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2))
        return resolve(trimmed)
    }

    async ensureRuntimeDirectories(
        vendor: AgentVendor,
        workingDirectory: string,
        agentHomeDirectory: string
    ): Promise<void> {
        try {
            await mkdir(workingDirectory, { recursive: true })
            await this.ensureAgentHomeDirectory(vendor, agentHomeDirectory)
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare Agent directories: ${this.errMsg(err)}`,
                { workingDirectory, agentHomeDirectory }
            )
        }
    }

    async ensureAgentHomeDirectory(
        vendor: AgentVendor,
        agentHomeDirectory: string
    ): Promise<void> {
        await mkdir(agentHomeDirectory, { recursive: true })
        await mkdir(this.vendorSkillsRoot(agentHomeDirectory, vendor), { recursive: true })
    }

    async ensureChatRuntimeDirectories(
        vendor: AgentVendor,
        workingDirectory: string,
        sessionHomeDirectory: string
    ): Promise<void> {
        try {
            await mkdir(workingDirectory, { recursive: true })
            await mkdir(sessionHomeDirectory, { recursive: true })
            await mkdir(this.vendorConfigRoot(sessionHomeDirectory, vendor), {
                recursive: true
            })
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to prepare chat directories: ${this.errMsg(err)}`,
                { workingDirectory, sessionHomeDirectory }
            )
        }
    }

    vendorConfigDirectoryName(vendor: AgentVendor): '.claude' | '.codex' {
        return vendor === 'claude' ? '.claude' : '.codex'
    }

    vendorConfigRoot(baseDirectory: string, vendor: AgentVendor): string {
        return join(baseDirectory, this.vendorConfigDirectoryName(vendor))
    }

    vendorSkillsRoot(baseDirectory: string, vendor: AgentVendor): string {
        return join(this.vendorConfigRoot(baseDirectory, vendor), 'skills')
    }

    async syncVendorConfigToWorkingDirectory(
        vendor: AgentVendor,
        agentHomeDirectory: string,
        workingDirectory: string
    ): Promise<void> {
        const sourceRoot = this.vendorConfigRoot(agentHomeDirectory, vendor)
        if (!(await this.isDirectory(sourceRoot))) return
        const destinationRoot = this.vendorConfigRoot(workingDirectory, vendor)
        try {
            await mkdir(destinationRoot, { recursive: true })
            const entries = await readdir(sourceRoot, { withFileTypes: true })
            for (const entry of entries) {
                const source = join(sourceRoot, entry.name)
                const destination = join(destinationRoot, entry.name)
                if (entry.isDirectory() && entry.name === 'skills') {
                    await this.copyMissingSkillDirectories(source, destination)
                    continue
                }
                if (await this.pathExists(destination)) continue
                await cp(source, destination, {
                    recursive: true,
                    errorOnExist: true,
                    force: false
                })
            }
        } catch (err) {
            throw BusinessException.badRequest(
                `Failed to sync ${this.vendorConfigDirectoryName(vendor)} into working directory: ${this.errMsg(err)}`,
                { sourceRoot, destinationRoot }
            )
        }
    }

    async importSkillSourceDirectories(
        sourceDirectories: string[],
        destinationSkillsRoot: string
    ): Promise<string[]> {
        await mkdir(destinationSkillsRoot, { recursive: true })
        const importedNames: string[] = []
        const seen = new Set<string>()
        for (const raw of sourceDirectories) {
            const sourceRoot = this.normalizeDirectoryPath(raw)
            const skillDirs = await this.collectSkillDirectories(sourceRoot)
            for (const skillDir of skillDirs) {
                const skill = await this.readSkillMetadata(skillDir)
                if (seen.has(skill.name)) {
                    throw BusinessException.badRequest(`Duplicate skill name "${skill.name}"`, {
                        skillName: skill.name,
                        sourceDirectory: skillDir
                    })
                }
                seen.add(skill.name)
                const destination = join(destinationSkillsRoot, skill.name)
                try {
                    await cp(skillDir, destination, {
                        recursive: true,
                        errorOnExist: true,
                        force: false
                    })
                } catch (err) {
                    throw BusinessException.badRequest(
                        `Failed to import skill "${skill.name}": ${this.errMsg(err)}`,
                        { skillName: skill.name, sourceDirectory: skillDir, destination }
                    )
                }
                importedNames.push(skill.name)
            }
        }
        return importedNames
    }

    private async copyMissingSkillDirectories(
        sourceRoot: string,
        destinationRoot: string
    ): Promise<void> {
        if (!(await this.isDirectory(sourceRoot))) return
        await mkdir(destinationRoot, { recursive: true })
        const entries = await readdir(sourceRoot, { withFileTypes: true })
        for (const entry of entries) {
            const source = join(sourceRoot, entry.name)
            const destination = join(destinationRoot, entry.name)
            if (await this.pathExists(destination)) continue
            await cp(source, destination, {
                recursive: true,
                errorOnExist: true,
                force: false
            })
        }
    }

    private async collectSkillDirectories(sourceRoot: string): Promise<string[]> {
        if (await this.hasSkillFile(sourceRoot)) return [sourceRoot]

        const vendorSkillDirs: string[] = []
        for (const vendor of ['claude', 'codex'] as const) {
            const skillsRoot = this.vendorSkillsRoot(sourceRoot, vendor)
            if (await this.isDirectory(skillsRoot)) {
                vendorSkillDirs.push(...(await this.collectChildSkillDirectories(skillsRoot)))
            }
        }
        if (vendorSkillDirs.length > 0) {
            return vendorSkillDirs
        }

        const childSkillDirs = await this.collectChildSkillDirectories(sourceRoot)
        if (childSkillDirs.length > 0) return childSkillDirs

        throw BusinessException.badRequest(
            `Skill directory "${sourceRoot}" must contain SKILL.md or skill subdirectories`
        )
    }

    private async collectChildSkillDirectories(parent: string): Promise<string[]> {
        try {
            const entries = await readdir(parent, { withFileTypes: true })
            const skillDirs: string[] = []
            for (const entry of entries) {
                if (!entry.isDirectory()) continue
                const child = join(parent, entry.name)
                if (await this.hasSkillFile(child)) skillDirs.push(child)
            }
            return skillDirs
        } catch (err) {
            throw BusinessException.badRequest(
                `Cannot read skill directory "${parent}": ${this.errMsg(err)}`
            )
        }
    }

    private async readSkillMetadata(skillDirectory: string): Promise<{ name: string }> {
        const skillFile = join(skillDirectory, 'SKILL.md')
        let content: string
        try {
            content = await readFile(skillFile, 'utf8')
        } catch (err) {
            throw BusinessException.badRequest(
                `Cannot read skill file "${skillFile}": ${this.errMsg(err)}`
            )
        }

        const rawName = this.extractSkillName(content) ?? basename(skillDirectory)
        const name = rawName.trim()
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
            throw BusinessException.badRequest(
                `Skill name "${name}" must contain only letters, numbers, ".", "_" or "-"`,
                { skillDirectory, skillFile }
            )
        }
        return { name }
    }

    private extractSkillName(content: string): string | null {
        const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
        if (!frontmatter) return null
        const nameLine = frontmatter[1].match(/^name:\s*(.+?)\s*$/m)
        if (!nameLine) return null
        return nameLine[1].replace(/^['"]|['"]$/g, '')
    }

    private async hasSkillFile(directory: string): Promise<boolean> {
        try {
            const s = await stat(join(directory, 'SKILL.md'))
            return s.isFile()
        } catch {
            return false
        }
    }

    private async isDirectory(path: string): Promise<boolean> {
        try {
            const s = await stat(path)
            return s.isDirectory()
        } catch {
            return false
        }
    }

    private async pathExists(path: string): Promise<boolean> {
        try {
            await stat(path)
            return true
        } catch {
            return false
        }
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
