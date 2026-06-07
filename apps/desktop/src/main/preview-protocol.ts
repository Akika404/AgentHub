import { ipcMain, protocol } from 'electron'
import { randomUUID } from 'node:crypto'

/**
 * Custom scheme that serves self-contained artifact-preview HTML to the
 * preview iframe.
 *
 * Why this exists: `blob:` / `data:` / `srcdoc` documents are "local schemes"
 * with no response of their own, so they inherit the *creator* document's CSP.
 * The renderer ships a strict `script-src 'self'` policy, which silently blocks
 * the inline / `data:` scripts the backend inlines into preview HTML — the page
 * renders its markup and CSS but no JavaScript ever runs.
 *
 * Serving the HTML over a real (standard, secure) scheme gives the iframe a
 * document with its own headers and no inherited CSP, so its scripts run. The
 * iframe stays `sandbox`ed (no `allow-same-origin`) so untrusted preview HTML
 * gets an opaque origin and can't reach the app, Node, or Electron.
 */

const SCHEME = 'agent-preview'
const HOST = 'preview'

/** id -> HTML payload awaiting (or being) served. */
const previews = new Map<string, string>()

/** Register the privileged scheme. MUST be called before the app is ready. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
    }
  ])
}

function idFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== `${SCHEME}:` || url.hostname !== HOST) return null
    const id = url.pathname.replace(/^\/+/, '')
    return id || null
  } catch {
    return null
  }
}

/** Wire the protocol handler and registration IPC. Call once after app ready. */
export function registerPreviewProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const id = idFromUrl(request.url)
    const html = id ? previews.get(id) : undefined
    if (html === undefined) {
      return new Response('Preview not found', {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    }
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })

  ipcMain.handle('preview:register-html', (_event, html: string): string => {
    const id = randomUUID()
    previews.set(id, typeof html === 'string' ? html : '')
    return `${SCHEME}://${HOST}/${id}`
  })

  ipcMain.handle('preview:release-html', (_event, url: string): void => {
    const id = idFromUrl(url)
    if (id) previews.delete(id)
  })
}
