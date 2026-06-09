import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

// Single shared instance. `breaks: true` keeps the old whitespace-pre-wrap feel
// (a single newline becomes a line break); `html: false` ignores raw HTML in the
// source so only markdown syntax is honored.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

// Open links in the external browser instead of navigating the Electron window.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Render markdown text to sanitized HTML safe for v-html. */
export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(md.render(text), { ADD_ATTR: ['target', 'rel'] })
}
