import { gunzipSync, gzipSync } from 'node:zlib'
import type { DataVersion } from '../data/version.ts'
import { log } from '../log.ts'
import type { Db } from './db.ts'

const FRESH_MS = 60 * 60 * 1000
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Decoded values kept in memory. */
const MEMO_ENTRIES = 12
/** Whole-network days take ~150 MB of heap each once indexed; keep at most this many in memory. */
const MEMO_HEAVY_ENTRIES = 2
const HEAVY_PREFIX = 'network:'

export interface Cached<T> {
  value: T
  /** Set when the API was unreachable and an older copy was served. */
  staleSince: number | undefined
}

interface Row {
  fetched_at: number
  version: string | null
}

/**
 * Cache for timetable responses, stored gzipped in SQLite. An entry is reused while it is under an
 * hour old, or under a day old with an unchanged `schedulesVersion`. If a refresh fails, the old copy
 * is served as stale. Decoded values are memoized in-process, so a large snapshot is parsed once.
 */
export class ScheduleCache {
  private readonly db: Db
  private readonly version: DataVersion
  private readonly now: () => number
  private readonly memo = new Map<string, { fetchedAt: number; value: unknown }>()

  constructor(db: Db, version: DataVersion, now: () => number = Date.now) {
    this.db = db
    this.version = version
    this.now = now
  }

  /** Whether `key` can be served without a request (may check the data version, at most hourly). */
  async isReady(key: string): Promise<boolean> {
    const row = this.row(key)
    return row !== undefined && (await this.isUsable(row))
  }

  async get<T>(
    key: string,
    expiresAt: number,
    fetcher: () => Promise<unknown>,
    decode: (body: unknown) => T,
  ): Promise<Cached<T>> {
    const row = this.row(key)
    if (row && (await this.isUsable(row)))
      return { value: this.decoded(key, row.fetched_at, decode), staleSince: undefined }

    try {
      // Tag the entry with the version current *before* the download, so a timetable published during
      // the download only causes an extra refresh, never a missed one. (At most one request per hour.)
      const version = await this.version.schedules()
      const body = await fetcher()
      const value = decode(body)
      const fetchedAt = this.now()
      this.db
        .prepare(
          `INSERT INTO http_cache (key, fetched_at, expires_at, version, body) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
             version = excluded.version, body = excluded.body`,
        )
        .run(key, fetchedAt, expiresAt, version ?? null, gzipSync(JSON.stringify(body)))
      this.remember(key, fetchedAt, value)
      return { value, staleSince: undefined }
    } catch (error) {
      if (!row) throw error
      log.warn('timetable refresh failed; serving cached copy', { key, error })
      return { value: this.decoded(key, row.fetched_at, decode), staleSince: row.fetched_at }
    }
  }

  private row(key: string): Row | undefined {
    return this.db.prepare('SELECT fetched_at, version FROM http_cache WHERE key = ?').get(key) as
      | Row
      | undefined
  }

  private decoded<T>(key: string, fetchedAt: number, decode: (body: unknown) => T): T {
    const hit = this.memo.get(key)
    if (hit && hit.fetchedAt === fetchedAt) return hit.value as T
    const { body } = this.db.prepare('SELECT body FROM http_cache WHERE key = ?').get(key) as {
      body: Uint8Array
    }
    const value = decode(JSON.parse(gunzipSync(body).toString('utf8')))
    this.remember(key, fetchedAt, value)
    return value
  }

  private remember(key: string, fetchedAt: number, value: unknown): void {
    this.memo.delete(key)
    this.memo.set(key, { fetchedAt, value })
    while (this.memo.size > MEMO_ENTRIES) this.memo.delete(this.memo.keys().next().value as string)
    const heavy = [...this.memo.keys()].filter((k) => k.startsWith(HEAVY_PREFIX))
    for (const k of heavy.slice(0, Math.max(0, heavy.length - MEMO_HEAVY_ENTRIES))) this.memo.delete(k)
  }

  private async isUsable(row: Row): Promise<boolean> {
    const age = this.now() - row.fetched_at
    if (age < FRESH_MS) return true
    if (age >= MAX_AGE_MS) return false
    const current = await this.version.schedules()
    // Unknown current version (API down): keep using the entry rather than fail.
    return current === undefined || current === row.version
  }
}
