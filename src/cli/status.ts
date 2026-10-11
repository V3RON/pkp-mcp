import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { App } from '../app.ts'
import { redact } from '../log.ts'
import { formatWarsawDateTime } from '../time.ts'

/** `pkp-mcp status [--remote]`: local cache/quota overview; --remote also asks the API about the key. */
export async function runStatus(app: App, remote: boolean): Promise<string> {
  const now = Date.now()
  const lines: string[] = []
  const dbPath = join(app.config.cacheDir, 'cache.db')
  lines.push(`cache:     ${dbPath} (${formatBytes(fileSize(dbPath))})`)
  lines.push(`api key:   ${app.config.apiKey ? 'set' : 'NOT SET (PKP_API_KEY)'}`)

  const fetchedAt = app.places.fetchedAt()
  const counts = app.places.counts()
  lines.push(
    `stations:  ${counts.stations} stations, ${counts.cities} cities` +
      (fetchedAt === undefined ? ' (not fetched yet)' : ` (fetched ${formatWarsawDateTime(fetchedAt)})`),
  )

  if (app.quota) {
    const q = app.quota.snapshot(now)
    const remaining =
      q.observedAt === undefined
        ? ''
        : `; API reported ${q.hourlyRemaining ?? '?'} left this hour, ${q.dailyRemaining ?? '?'} today` +
          ` (at ${formatWarsawDateTime(q.observedAt)})`
    lines.push(`requests:  ${q.lastHour} in the last hour, ${q.lastDay} in the last 24 h${remaining}`)
  }

  if (remote) {
    for (const path of ['api/v1/apikey/info', 'api/v1/apikey/usage']) {
      try {
        const body = await app.client.getJson(path)
        lines.push(`${path}:`, redact(JSON.stringify(body, null, 2)))
      } catch (error) {
        lines.push(`${path}: ${redact(error instanceof Error ? error.message : String(error))}`)
      }
    }
  }
  return lines.join('\n')
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
