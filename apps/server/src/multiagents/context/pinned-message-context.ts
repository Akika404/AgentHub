export interface PinnedMessageContextItem {
    sender: string
    kind: string
    text: string
    createdAt: Date
}

const DEFAULT_MAX_ITEMS = 20
const DEFAULT_MAX_CHARS = 4000

export function renderPinnedMessagesContext(
    title: string,
    items: PinnedMessageContextItem[],
    options: { maxItems?: number; maxChars?: number } = {}
): string {
    const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS
    const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
    const visible = items.slice(0, maxItems)
    const lines = [`# ${title}`]
    let omitted = Math.max(0, items.length - visible.length)
    let truncated = false

    for (const item of visible) {
        const text = compactText(item.text)
        if (!text) continue
        const line = `- [${item.createdAt.toISOString()}] ${item.sender} (${item.kind}): ${text}`
        const next = [...lines, line]
        const nextText = next.join('\n')
        if (nextText.length > maxChars) {
            truncated = true
            omitted += visible.length - lines.length + 1
            break
        }
        lines.push(line)
    }

    if (lines.length === 1) return ''
    if (omitted > 0) lines.push(`- ... omitted ${omitted} pinned message(s)`)
    else if (truncated) lines.push('- ... truncated due to context budget')
    return lines.join('\n')
}

export function compactText(text: string, maxLength = 800): string {
    const normalized = text.replace(/\s+/g, ' ').trim()
    if (normalized.length <= maxLength) return normalized
    return `${normalized.slice(0, maxLength)}...`
}
