import { gunzipSync, gzipSync } from 'node:zlib'
import type { Db } from './db.ts'

/**
 * Plain time-based cache for fast-changing data (live positions, disruptions), shared across
 * processes through SQLite. No stale fallback: old live data would be misleading.
 */
export class TtlCache {
  private readonly db: Db
  private readonly now: () => number
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db
    this.now = now
  }

  async get(
    key: string,
    ttlMs: (body: unknown) => number,
    fetcher: () => Promise<unknown>,
  ): Promise<unknown> {
    const row = this.db.prepare('SELECT expires_at, body FROM http_cache WHERE key = ?').get(key) as
      | { expires_at: number; body: Uint8Array }
      | undefined
    if (row && row.expires_at > this.now()) return JSON.parse(gunzipSync(row.body).toString('utf8'))

    const pending = this.inflight.get(key)
    if (pending) return pending
    const request = fetcher()
      .then((body) => {
        const at = this.now()
        this.db
          .prepare(
            `INSERT INTO http_cache (key, fetched_at, expires_at, version, body) VALUES (?, ?, ?, NULL, ?)
             ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at,
               version = NULL, body = excluded.body`,
          )
          .run(key, at, at + ttlMs(body), gzipSync(JSON.stringify(body)))
        return body
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return request
  }
}
