/**
 * Format an ISO timestamp string as a localized short time (e.g. "10:24 AM").
 * Falls back to the raw string if it cannot be parsed.
 */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
