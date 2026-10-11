import { createHash } from 'node:crypto'
import type { Db } from './db.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Quota rows are keyed by a hash so the key itself is never written to disk. */
export function keyHash(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

export interface QuotaSnapshot {
  lastHour: number
  lastDay: number
  hourlyRemaining: number | undefined
  dailyRemaining: number | undefined
  observedAt: number | undefined
}

/**
 * Counts every HTTP request this machine sent with a key (shared across all server processes via
 * SQLite), plus the last remaining-quota values the API reported in headers, if it sends them.
 */
export class QuotaTracker {
  private readonly db: Db
  private readonly hash: string

  constructor(db: Db, apiKey: string) {
    this.db = db
    this.hash = keyHash(apiKey)
  }

  record(at: number, headers?: Headers): void {
    this.db.prepare('INSERT INTO requests (key_hash, at) VALUES (?, ?)').run(this.hash, at)
    const hourly = intHeader(headers, 'x-ratelimit-hourly-remaining')
    const daily = intHeader(headers, 'x-ratelimit-daily-remaining')
    if (hourly !== undefined || daily !== undefined) {
      this.db
        .prepare(
          `INSERT INTO quota (key_hash, hourly_remaining, daily_remaining, observed_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (key_hash) DO UPDATE SET hourly_remaining = excluded.hourly_remaining,
             daily_remaining = excluded.daily_remaining, observed_at = excluded.observed_at`,
        )
        .run(this.hash, hourly ?? null, daily ?? null, at)
    }
  }

  snapshot(now: number): QuotaSnapshot {
    const count = (since: number) =>
      (
        this.db
          .prepare('SELECT COUNT(*) AS n FROM requests WHERE key_hash = ? AND at > ?')
          .get(this.hash, since) as {
          n: number
        }
      ).n
    const row = this.db
      .prepare('SELECT hourly_remaining, daily_remaining, observed_at FROM quota WHERE key_hash = ?')
      .get(this.hash) as
      | { hourly_remaining: number | null; daily_remaining: number | null; observed_at: number }
      | undefined
    return {
      lastHour: count(now - HOUR_MS),
      lastDay: count(now - DAY_MS),
      hourlyRemaining: row?.hourly_remaining ?? undefined,
      dailyRemaining: row?.daily_remaining ?? undefined,
      observedAt: row?.observed_at,
    }
  }
}

function intHeader(headers: Headers | undefined, name: string): number | undefined {
  const raw = headers?.get(name)
  if (raw == null || raw === '') return undefined
  const value = Number(raw)
  return Number.isInteger(value) ? value : undefined
}
