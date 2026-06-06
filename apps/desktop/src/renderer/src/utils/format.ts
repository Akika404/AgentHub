/**
 * Format an ISO timestamp string as a localized 24-hour short time (e.g. "17:11").
 * Falls back to the raw string if it cannot be parsed.
 */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}
