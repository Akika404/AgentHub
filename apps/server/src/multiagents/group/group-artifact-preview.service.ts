import { Injectable } from '@nestjs/common'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type {
    BlackboardArtifact,
    BlackboardArtifactPreview,
    BlackboardArtifactPreviewKind
} from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { BlackboardService } from './blackboard/blackboard.service.js'
import { GroupWorkspaceService } from './group-workspace.service.js'

const HIDDEN_ARTIFACT_DIRS = new Set(['.codex', '.agents', '.claude'])
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_DATA_URL_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_HTML_EMBED_RESOURCE_BYTES = 8 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
    '.bash',
    '.c',
    '.cc',
    '.conf',
    '.cpp',
    '.cs',
    '.css',
    '.csv',
    '.env',
    '.go',
    '.h',
    '.hpp',
    '.java',
    '.js',
    '.json',
    '.jsx',
    '.kt',
    '.log',
    '.lua',
    '.mjs',
    '.md',
    '.mdx',
    '.php',
    '.py',
    '.rb',
    '.rs',
    '.scss',
    '.sh',
    '.sql',
    '.swift',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml',
    '.zsh'
])

const TEXT_FILE_NAMES = new Set([
    '.gitignore',
    '.npmrc',
    '.prettierrc',
    'Dockerfile',
    'LICENSE',
    'README'
])

const MIME_BY_EXTENSION = new Map<string, string>([
    ['.aac', 'audio/aac'],
    ['.avi', 'video/x-msvideo'],
    ['.css', 'text/css; charset=utf-8'],
    ['.csv', 'text/csv; charset=utf-8'],
    ['.gif', 'image/gif'],
    ['.htm', 'text/html; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.m4a', 'audio/mp4'],
    ['.md', 'text/markdown; charset=utf-8'],
    ['.mov', 'video/quicktime'],
    ['.mp3', 'audio/mpeg'],
    ['.mp4', 'video/mp4'],
    ['.ogg', 'audio/ogg'],
    ['.pdf', 'application/pdf'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.wav', 'audio/wav'],
    ['.webm', 'video/webm'],
    ['.webp', 'image/webp'],
    ['.xml', 'application/xml; charset=utf-8']
])

/**
 * Reads a blackboard artifact's workspace file and produces a UI-friendly preview payload.
 * The file path always comes from the blackboard artifact, never from client input.
 */
@Injectable()
export class GroupArtifactPreviewService {
    constructor(
        private readonly blackboard: BlackboardService,
        private readonly workspace: GroupWorkspaceService
    ) {}

    async preview(
        groupId: string,
        workspaceDir: string,
        artifactId: string
    ): Promise<BlackboardArtifactPreview> {
        const artifact = await this.blackboard.getArtifactById(groupId, artifactId)
        if (!artifact) throw BusinessException.notFound(`Artifact ${artifactId} not found`)

        this.assertAllowedArtifactPath(artifact.path)
        const repo = resolve(this.workspace.repoDir(groupId, workspaceDir))
        const filePath = resolve(repo, artifact.path)
        this.assertPathInsideRepo(repo, filePath)

        const info = await this.fileInfo(filePath, artifact)
        if (info.size > this.limitFor(info.previewKind)) {
            return this.buildPreview(artifact, info, {
                previewKind: 'too_large',
                message: `文件过大，暂不在应用内预览（${this.formatBytes(info.size)}）。`
            })
        }

        if (info.previewKind === 'html') {
            const content = await readFile(filePath, 'utf8')
            return this.buildPreview(artifact, info, {
                content: await this.embedHtmlResources(content, repo, filePath)
            })
        }

        if (info.previewKind === 'text') {
            const content = await readFile(filePath, 'utf8')
            return this.buildPreview(artifact, info, { content })
        }

        if (this.usesDataUrl(info.previewKind)) {
            const bytes = await readFile(filePath)
            return this.buildPreview(artifact, info, {
                dataUrl: `data:${info.mimeType};base64,${bytes.toString('base64')}`
            })
        }

        if (info.previewKind === 'office') {
            return this.buildPreview(artifact, info, {
                message: '当前版本暂不支持在应用内直接渲染 Office 文档。'
            })
        }

        return this.buildPreview(artifact, info, {
            message: '该文件类型暂不支持在应用内预览。'
        })
    }

    private async fileInfo(
        filePath: string,
        artifact: BlackboardArtifact
    ): Promise<{
        fileName: string
        extension: string
        mimeType: string
        size: number
        previewKind: BlackboardArtifactPreviewKind
    }> {
        let stats: Awaited<ReturnType<typeof stat>>
        try {
            stats = await stat(filePath)
        } catch {
            throw BusinessException.notFound(`Artifact file ${artifact.path} not found`)
        }
        if (!stats.isFile()) {
            throw BusinessException.badRequest(`Artifact ${artifact.path} is not a file`)
        }

        const fileName = basename(artifact.path)
        const extension = extname(fileName).toLowerCase()
        const mimeType = MIME_BY_EXTENSION.get(extension) ?? 'application/octet-stream'
        return {
            fileName,
            extension,
            mimeType,
            size: stats.size,
            previewKind: this.previewKind(extension, fileName, mimeType)
        }
    }

    private previewKind(
        extension: string,
        fileName: string,
        mimeType: string
    ): BlackboardArtifactPreviewKind {
        if (extension === '.html' || extension === '.htm') return 'html'
        if (extension === '.pdf') return 'pdf'
        if (['.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx'].includes(extension)) return 'office'
        if (mimeType.startsWith('image/')) return 'image'
        if (mimeType.startsWith('audio/')) return 'audio'
        if (mimeType.startsWith('video/')) return 'video'
        if (TEXT_EXTENSIONS.has(extension) || TEXT_FILE_NAMES.has(fileName)) return 'text'
        return 'binary'
    }

    private buildPreview(
        artifact: BlackboardArtifact,
        info: {
            fileName: string
            extension: string
            mimeType: string
            size: number
            previewKind: BlackboardArtifactPreviewKind
        },
        override: {
            previewKind?: BlackboardArtifactPreviewKind
            content?: string | null
            dataUrl?: string | null
            message?: string | null
        } = {}
    ): BlackboardArtifactPreview {
        return {
            artifact,
            fileName: info.fileName,
            extension: info.extension,
            mimeType: info.mimeType,
            size: info.size,
            previewKind: override.previewKind ?? info.previewKind,
            content: override.content ?? null,
            dataUrl: override.dataUrl ?? null,
            message: override.message ?? null
        }
    }

    private limitFor(previewKind: BlackboardArtifactPreviewKind): number {
        return previewKind === 'text' || previewKind === 'html'
            ? MAX_TEXT_PREVIEW_BYTES
            : MAX_DATA_URL_PREVIEW_BYTES
    }

    private usesDataUrl(previewKind: BlackboardArtifactPreviewKind): boolean {
        return ['pdf', 'image', 'audio', 'video'].includes(previewKind)
    }

    private async embedHtmlResources(html: string, repo: string, htmlPath: string): Promise<string> {
        let next = html
        next = await this.replaceAsync(
            next,
            /<script\b([^>]*?)\s+src=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
            async (match, before: string, _quote: string, src: string, after: string) => {
                const resource = await this.readLocalTextResource(repo, htmlPath, src)
                if (!resource) return match
                const js = await this.embedJavaScriptImports(resource.content, repo, resource.filePath)
                return `<script${before}${after}>${this.escapeScriptContent(js)}</script>`
            }
        )

        next = await this.replaceAsync(next, /<link\b[^>]*>/gi, async (tag) => {
            const rel = this.attrValue(tag, 'rel')
            const href = this.attrValue(tag, 'href')
            if (!href || !rel?.toLowerCase().split(/\s+/).includes('stylesheet')) return tag
            const resource = await this.readLocalTextResource(repo, htmlPath, href)
            if (!resource) return tag
            const css = await this.embedCssUrls(resource.content, repo, resource.filePath)
            return `<style>${this.escapeStyleContent(css)}</style>`
        })

        next = await this.inlineHtmlDataAttributes(next, repo, htmlPath, 'src')
        next = await this.inlineHtmlDataAttributes(next, repo, htmlPath, 'poster')
        return next
    }

    private async inlineHtmlDataAttributes(
        html: string,
        repo: string,
        baseFile: string,
        attrName: 'poster' | 'src'
    ): Promise<string> {
        const pattern = new RegExp(`\\s${attrName}=(["'])([^"']+)\\1`, 'gi')
        return this.replaceAsync(html, pattern, async (match, quote: string, rawUrl: string) => {
            const dataUrl = await this.localResourceDataUrl(repo, baseFile, rawUrl)
            return dataUrl ? ` ${attrName}=${quote}${dataUrl}${quote}` : match
        })
    }

    private async embedCssUrls(css: string, repo: string, cssPath: string): Promise<string> {
        return this.replaceAsync(
            css,
            /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
            async (match, quote: string, rawUrl: string) => {
                const dataUrl = await this.localResourceDataUrl(repo, cssPath, rawUrl)
                return dataUrl ? `url(${quote}${dataUrl}${quote})` : match
            }
        )
    }

    private async embedJavaScriptImports(
        code: string,
        repo: string,
        jsPath: string,
        depth = 0
    ): Promise<string> {
        if (depth > 4) return code
        return this.replaceAsync(
            code,
            /\b(from\s*["']|import\s*["']|import\(\s*["'])([^"']+)(["'])/g,
            async (match, prefix: string, rawUrl: string, suffix: string) => {
                const resource = await this.readLocalTextResource(repo, jsPath, rawUrl)
                if (!resource) return match
                const embedded = await this.embedJavaScriptImports(
                    resource.content,
                    repo,
                    resource.filePath,
                    depth + 1
                )
                const dataUrl = this.textDataUrl(resource.mimeType, embedded)
                return `${prefix}${dataUrl}${suffix}`
            }
        )
    }

    private async readLocalTextResource(
        repo: string,
        baseFile: string,
        rawUrl: string
    ): Promise<{ content: string; filePath: string; mimeType: string } | null> {
        const filePath = this.resolveLocalResourcePath(repo, baseFile, rawUrl)
        if (!filePath) return null
        try {
            const stats = await stat(filePath)
            if (!stats.isFile() || stats.size > MAX_HTML_EMBED_RESOURCE_BYTES) return null
            return {
                content: await readFile(filePath, 'utf8'),
                filePath,
                mimeType: MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? 'text/plain'
            }
        } catch {
            return null
        }
    }

    private async localResourceDataUrl(
        repo: string,
        baseFile: string,
        rawUrl: string
    ): Promise<string | null> {
        const filePath = this.resolveLocalResourcePath(repo, baseFile, rawUrl)
        if (!filePath) return null
        try {
            const stats = await stat(filePath)
            if (!stats.isFile() || stats.size > MAX_HTML_EMBED_RESOURCE_BYTES) return null
            const mimeType =
                MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream'
            const bytes = await readFile(filePath)
            return `data:${mimeType};base64,${bytes.toString('base64')}`
        } catch {
            return null
        }
    }

    private resolveLocalResourcePath(repo: string, baseFile: string, rawUrl: string): string | null {
        const pathPart = rawUrl.trim().split(/[?#]/, 1)[0]
        if (
            !pathPart ||
            pathPart.startsWith('#') ||
            pathPart.startsWith('//') ||
            /^[a-z][a-z0-9+.-]*:/i.test(pathPart)
        ) {
            return null
        }

        let decoded: string
        try {
            decoded = decodeURIComponent(pathPart)
        } catch {
            decoded = pathPart
        }

        const filePath = decoded.startsWith('/')
            ? resolve(repo, `.${decoded}`)
            : resolve(dirname(baseFile), decoded)
        try {
            this.assertPathInsideRepo(repo, filePath)
            this.assertAllowedArtifactPath(relative(repo, filePath))
        } catch {
            return null
        }
        return filePath
    }

    private attrValue(tag: string, attrName: string): string | null {
        const match = tag.match(new RegExp(`\\s${attrName}=(["'])(.*?)\\1`, 'i'))
        return match?.[2] ?? null
    }

    private textDataUrl(mimeType: string, text: string): string {
        return `data:${mimeType};base64,${Buffer.from(text, 'utf8').toString('base64')}`
    }

    private escapeScriptContent(content: string): string {
        return content.replace(/<\/script/gi, '<\\/script')
    }

    private escapeStyleContent(content: string): string {
        return content.replace(/<\/style/gi, '<\\/style')
    }

    private async replaceAsync(
        input: string,
        pattern: RegExp,
        replacer: (...args: string[]) => Promise<string>
    ): Promise<string> {
        const matches = [...input.matchAll(pattern)]
        if (matches.length === 0) return input
        const replacements = await Promise.all(matches.map((match) => replacer(...(match as string[]))))
        let offset = 0
        let output = input
        for (let i = 0; i < matches.length; i++) {
            const match = matches[i]
            const replacement = replacements[i]
            const index = match.index
            if (index === undefined) continue
            output =
                output.slice(0, index + offset) +
                replacement +
                output.slice(index + offset + match[0].length)
            offset += replacement.length - match[0].length
        }
        return output
    }

    private assertAllowedArtifactPath(path: string): void {
        if (!path || isAbsolute(path)) {
            throw BusinessException.badRequest('Artifact path must be relative to the group workspace')
        }
        const segments = path.split(/[\\/]+/).filter(Boolean)
        if (segments.some((segment) => segment === '..')) {
            throw BusinessException.badRequest('Artifact path cannot contain parent directory segments')
        }
        if (segments.some((segment) => HIDDEN_ARTIFACT_DIRS.has(segment))) {
            throw BusinessException.forbidden('Artifact is not previewable')
        }
    }

    private assertPathInsideRepo(repo: string, filePath: string): void {
        const rel = relative(repo, filePath)
        if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
            throw BusinessException.badRequest('Artifact file must be inside the group workspace')
        }
    }

    private formatBytes(size: number): string {
        if (size < 1024) return `${size} B`
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
        return `${(size / 1024 / 1024).toFixed(1)} MB`
    }
}
