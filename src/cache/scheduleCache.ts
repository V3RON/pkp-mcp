import type { DataVersion } from '../data/version.ts'
import { log } from '../log.ts'
import type { Db } from './db.ts'

const FRESH_MS = 60 * 60 * 1000
const MAX_AGE_MS = 24 * 60 * 60 * 1000

export interface CachedBody {
  body: unknown
  /** Set when the API was unreachable and an older copy was served. */
  staleSince: number | undefined
}

/**
 * Cache for timetable responses. An entry is reused while it is under an hour old, or under a day
 * old with an unchanged `schedulesVersion`. If a refresh fails, the old copy is served as stale.
 */
export class ScheduleCache {
  private readonly db: Db
  private readonly version: DataVersion
  private readonly now: () => number

  constructor(db: Db, version: DataVersion, now: () => number = Date.now) {
    this.db = db
    this.version = version
    this.now = now
  }

  async get(key: string, expiresAt: number, fetcher: () => Promise<unknown>): Promise<CachedBody> {
    const row = this.db.prepare('SELECT fetched_at, version, body FROM http_cache WHERE key = ?').get(key) as
      | { fetched_at: number; version: string | null; body: string }
      | undefined
    if (row && (await this.isUsable(row))) return { body: JSON.parse(row.body), staleSince: undefined }

    try {
      const body = await fetcher()
      this.db
        .prepare(
          `INSERT INTO http_cache (key, fetched_at, expires_at, version, body) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
             version = excluded.version, body = excluded.body`,
        )
        .run(key, this.now(), expiresAt, this.version.known() ?? null, JSON.stringify(body))
      return { body, staleSince: undefined }
    } catch (error) {
      if (!row) throw error
      log.warn('timetable refresh failed; serving cached copy', { key, error })
      return { body: JSON.parse(row.body), staleSince: row.fetched_at }
    }
  }

  private async isUsable(row: { fetched_at: number; version: string | null }): Promise<boolean> {
    const age = this.now() - row.fetched_at
    if (age < FRESH_MS) return true
    if (age >= MAX_AGE_MS) return false
    const current = await this.version.schedules()
    // Unknown current version (API down): keep using the entry rather than fail.
    return current === undefined || current === row.version
  }
}
