/**
 * Inline artifact preview helpers (renderer side).
 *
 * Mirrors the backend `previewKind` classification just enough to decide which
 * artifacts deserve an inline preview card and which icon/label to show. The
 * authoritative preview (content, dataUrl, too_large) is still produced by
 * `GET …/blackboard/artifacts/:id/preview` when the card is opened.
 */

function extOf(path: string): string {
  const name = path.split(/[\\/]+/).pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const HTML_EXT = new Set(['html', 'htm'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const PDF_EXT = new Set(['pdf'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'ogv'])
const TEXT_EXT = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'xml',
  'csv',
  'js',
  'ts',
  'jsx',
  'tsx',
  'vue',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'py',
  'java',
  'kt',
  'go',
  'rs',
  'c',
  'cpp',
  'h',
  'hpp',
  'sh',
  'sql',
  'toml',
  'ini',
  'env'
])

/** True when the artifact type renders in-app (html/pdf/image/audio/video/text). */
export function isInlinePreviewable(path: string): boolean {
  const ext = extOf(path)
  return (
    HTML_EXT.has(ext) ||
    IMAGE_EXT.has(ext) ||
    PDF_EXT.has(ext) ||
    AUDIO_EXT.has(ext) ||
    VIDEO_EXT.has(ext) ||
    TEXT_EXT.has(ext)
  )
}

/** Last path segment, for the card title. */
export function artifactFileName(path: string): string {
  return path.split(/[\\/]+/).pop() ?? path
}

/** material-symbols icon name matching the artifact's preview kind. */
export function artifactIcon(path: string): string {
  const ext = extOf(path)
  if (HTML_EXT.has(ext)) return 'language'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (PDF_EXT.has(ext)) return 'picture_as_pdf'
  if (AUDIO_EXT.has(ext)) return 'audio_file'
  if (VIDEO_EXT.has(ext)) return 'movie'
  if (TEXT_EXT.has(ext)) return 'description'
  return 'draft'
}

/** Short human label for the card's kind chip. */
export function artifactKindLabel(path: string): string {
  const ext = extOf(path)
  if (HTML_EXT.has(ext)) return '网页'
  if (IMAGE_EXT.has(ext)) return '图片'
  if (PDF_EXT.has(ext)) return 'PDF'
  if (AUDIO_EXT.has(ext)) return '音频'
  if (VIDEO_EXT.has(ext)) return '视频'
  if (TEXT_EXT.has(ext)) return '文档'
  return '文件'
}
