export const DEFAULT_AGENT_COLOR = '#3370ff'

const AVATAR_CANVAS_SIZE = 256
const AVATAR_MAX_DATA_URL_LENGTH = 256 * 1024
const AVATAR_QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6]
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value)
}

export function normalizeAgentColor(color: string | null | undefined): string {
  const trimmed = color?.trim()
  return isHexColor(trimmed) ? trimmed.toLowerCase() : DEFAULT_AGENT_COLOR
}

export function agentInitials(name: string): string {
  const chars = Array.from(name.trim()).filter((char) => char.trim().length > 0)
  return chars.slice(0, 2).join('').toUpperCase() || 'AG'
}

export function avatarTextColor(color: string | null | undefined): string {
  const normalized = normalizeAgentColor(color)
  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.62 ? '#1f2329' : '#ffffff'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') resolve(result)
      else reject(new Error('Invalid avatar file'))
    }
    reader.onerror = () => reject(new Error('Failed to read avatar file'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Invalid avatar image'))
    image.src = src
  })
}

export async function createAvatarDataUrl(file: File): Promise<string> {
  const source = await readFileAsDataUrl(file)
  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_CANVAS_SIZE
  canvas.height = AVATAR_CANVAS_SIZE

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is not available')

  const width = image.naturalWidth || image.width
  const height = image.naturalHeight || image.height
  const sourceSize = Math.min(width, height)
  const sourceX = (width - sourceSize) / 2
  const sourceY = (height - sourceSize) / 2

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE)
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    AVATAR_CANVAS_SIZE,
    AVATAR_CANVAS_SIZE
  )

  for (const quality of AVATAR_QUALITY_STEPS) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length <= AVATAR_MAX_DATA_URL_LENGTH) return dataUrl
  }

  throw new Error('Avatar image is too large')
}
