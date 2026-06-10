import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ArtifactFilePreview, BlackboardArtifactPreviewKind } from '@agenthub/shared'

/**
 * 框架无关的产物文件预览构建器。
 *
 * 从一个仓库根目录 + 仓库内相对路径读取文件,产出 {@link ArtifactFilePreview}
 * (文本/HTML 内联/图片等 dataUrl/过大提示...)。不依赖 blackboard 或 NestJS,
 * 供服务器(群聊 / 单聊)与桌面端本机 runner(local 模式)共用同一套实现。
 *
 * 路径安全:`relPath` 必须相对、不含 `..`、不落在隐藏 agent 目录,且解析后仍在
 * 仓库内;调用方下发的路径与本地二次校验都走这里。
 */

const HIDDEN_ARTIFACT_DIRS = new Set(['.codex', '.agents', '.claude'])
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_DATA_URL_PREVIEW_BYTES = 12 * 1024 * 1024
const MAX_HTML_EMBED_RESOURCE_BYTES = 8 * 1024 * 1024

/** 抛给调用方的预览错误;调用方按 reason 映射到各自框架的异常(404 / 400 / 403)。 */
export type ArtifactPreviewErrorReason = 'not_found' | 'bad_request' | 'forbidden'

export class ArtifactPreviewError extends Error {
  constructor(
    readonly reason: ArtifactPreviewErrorReason,
    message: string
  ) {
    super(message)
    this.name = 'ArtifactPreviewError'
  }
}

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

interface FileInfo {
  fileName: string
  extension: string
  mimeType: string
  size: number
  previewKind: BlackboardArtifactPreviewKind
}

// PLACEHOLDER_BODY

/**
 * 读取 `repoDir/relPath` 并生成预览负载。失败时抛 {@link ArtifactPreviewError}。
 */
export async function buildArtifactPreview(
  repoDir: string,
  relPath: string
): Promise<ArtifactFilePreview> {
  assertAllowedArtifactPath(relPath)
  const repo = resolve(repoDir)
  const filePath = resolve(repo, relPath)
  assertPathInsideRepo(repo, filePath)

  const info = await fileInfo(filePath, relPath)
  if (info.size > limitFor(info.previewKind)) {
    return buildPreview(info, {
      previewKind: 'too_large',
      message: `文件过大，暂不在应用内预览（${formatBytes(info.size)}）。`
    })
  }

  if (info.previewKind === 'html') {
    const content = await readFile(filePath, 'utf8')
    return buildPreview(info, { content: await embedHtmlResources(content, repo, filePath) })
  }

  if (info.previewKind === 'text') {
    const content = await readFile(filePath, 'utf8')
    return buildPreview(info, { content })
  }

  if (usesDataUrl(info.previewKind)) {
    const bytes = await readFile(filePath)
    return buildPreview(info, {
      dataUrl: `data:${info.mimeType};base64,${bytes.toString('base64')}`
    })
  }

  if (info.previewKind === 'office') {
    return buildPreview(info, {
      message: '当前版本暂不支持在应用内直接渲染 Office 文档。'
    })
  }

  return buildPreview(info, { message: '该文件类型暂不支持在应用内预览。' })
}

async function fileInfo(filePath: string, relPath: string): Promise<FileInfo> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(filePath)
  } catch {
    throw new ArtifactPreviewError('not_found', `Artifact file ${relPath} not found`)
  }
  if (!stats.isFile()) {
    throw new ArtifactPreviewError('bad_request', `Artifact ${relPath} is not a file`)
  }

  const fileName = basename(relPath)
  const extension = extname(fileName).toLowerCase()
  const mimeType = MIME_BY_EXTENSION.get(extension) ?? 'application/octet-stream'
  return {
    fileName,
    extension,
    mimeType,
    size: stats.size,
    previewKind: previewKind(extension, fileName, mimeType)
  }
}

function previewKind(
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

function buildPreview(
  info: FileInfo,
  override: {
    previewKind?: BlackboardArtifactPreviewKind
    content?: string | null
    dataUrl?: string | null
    message?: string | null
  } = {}
): ArtifactFilePreview {
  return {
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

function limitFor(kind: BlackboardArtifactPreviewKind): number {
  return kind === 'text' || kind === 'html' ? MAX_TEXT_PREVIEW_BYTES : MAX_DATA_URL_PREVIEW_BYTES
}

function usesDataUrl(kind: BlackboardArtifactPreviewKind): boolean {
  return ['pdf', 'image', 'audio', 'video'].includes(kind)
}

// PLACEHOLDER_HTML

async function embedHtmlResources(html: string, repo: string, htmlPath: string): Promise<string> {
  let next = html
  next = await replaceAsync(
    next,
    /<script\b([^>]*?)\s+src=(["'])([^"']+)\2([^>]*)>\s*<\/script>/gi,
    async (match, before: string, _quote: string, src: string, after: string) => {
      const resource = await readLocalTextResource(repo, htmlPath, src)
      if (!resource) return match
      const js = await embedJavaScriptImports(resource.content, repo, resource.filePath)
      return `<script${before}${after}>${escapeScriptContent(js)}</script>`
    }
  )

  next = await replaceAsync(next, /<link\b[^>]*>/gi, async (tag) => {
    const rel = attrValue(tag, 'rel')
    const href = attrValue(tag, 'href')
    if (!href || !rel?.toLowerCase().split(/\s+/).includes('stylesheet')) return tag
    const resource = await readLocalTextResource(repo, htmlPath, href)
    if (!resource) return tag
    const css = await embedCssUrls(resource.content, repo, resource.filePath)
    return `<style>${escapeStyleContent(css)}</style>`
  })

  next = await inlineHtmlDataAttributes(next, repo, htmlPath, 'src')
  next = await inlineHtmlDataAttributes(next, repo, htmlPath, 'poster')
  return next
}

async function inlineHtmlDataAttributes(
  html: string,
  repo: string,
  baseFile: string,
  attrName: 'poster' | 'src'
): Promise<string> {
  const pattern = new RegExp(`\\s${attrName}=(["'])([^"']+)\\1`, 'gi')
  return replaceAsync(html, pattern, async (match, quote: string, rawUrl: string) => {
    const dataUrl = await localResourceDataUrl(repo, baseFile, rawUrl)
    return dataUrl ? ` ${attrName}=${quote}${dataUrl}${quote}` : match
  })
}

async function embedCssUrls(css: string, repo: string, cssPath: string): Promise<string> {
  return replaceAsync(
    css,
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    async (match, quote: string, rawUrl: string) => {
      const dataUrl = await localResourceDataUrl(repo, cssPath, rawUrl)
      return dataUrl ? `url(${quote}${dataUrl}${quote})` : match
    }
  )
}

async function embedJavaScriptImports(
  code: string,
  repo: string,
  jsPath: string,
  depth = 0
): Promise<string> {
  if (depth > 4) return code
  return replaceAsync(
    code,
    /\b(from\s*["']|import\s*["']|import\(\s*["'])([^"']+)(["'])/g,
    async (match, prefix: string, rawUrl: string, suffix: string) => {
      const resource = await readLocalTextResource(repo, jsPath, rawUrl)
      if (!resource) return match
      const embedded = await embedJavaScriptImports(resource.content, repo, resource.filePath, depth + 1)
      const dataUrl = textDataUrl(resource.mimeType, embedded)
      return `${prefix}${dataUrl}${suffix}`
    }
  )
}

async function readLocalTextResource(
  repo: string,
  baseFile: string,
  rawUrl: string
): Promise<{ content: string; filePath: string; mimeType: string } | null> {
  const filePath = resolveLocalResourcePath(repo, baseFile, rawUrl)
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

async function localResourceDataUrl(
  repo: string,
  baseFile: string,
  rawUrl: string
): Promise<string | null> {
  const filePath = resolveLocalResourcePath(repo, baseFile, rawUrl)
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

function resolveLocalResourcePath(repo: string, baseFile: string, rawUrl: string): string | null {
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
    assertPathInsideRepo(repo, filePath)
    assertAllowedArtifactPath(relative(repo, filePath))
  } catch {
    return null
  }
  return filePath
}

function attrValue(tag: string, attrName: string): string | null {
  const match = tag.match(new RegExp(`\\s${attrName}=(["'])(.*?)\\1`, 'i'))
  return match?.[2] ?? null
}

function textDataUrl(mimeType: string, text: string): string {
  return `data:${mimeType};base64,${Buffer.from(text, 'utf8').toString('base64')}`
}

function escapeScriptContent(content: string): string {
  return content.replace(/<\/script/gi, '<\\/script')
}

function escapeStyleContent(content: string): string {
  return content.replace(/<\/style/gi, '<\\/style')
}

async function replaceAsync(
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

function assertAllowedArtifactPath(path: string): void {
  if (!path || isAbsolute(path)) {
    throw new ArtifactPreviewError(
      'bad_request',
      'Artifact path must be relative to the workspace'
    )
  }
  const segments = path.split(/[\\/]+/).filter(Boolean)
  if (segments.some((segment) => segment === '..')) {
    throw new ArtifactPreviewError(
      'bad_request',
      'Artifact path cannot contain parent directory segments'
    )
  }
  if (segments.some((segment) => HIDDEN_ARTIFACT_DIRS.has(segment))) {
    throw new ArtifactPreviewError('forbidden', 'Artifact is not previewable')
  }
}

function assertPathInsideRepo(repo: string, filePath: string): void {
  const rel = relative(repo, filePath)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ArtifactPreviewError('bad_request', 'Artifact file must be inside the workspace')
  }
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}


