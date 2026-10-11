import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { getMeta, openCacheDb, SCHEMA_VERSION, setMeta } from '../src/cache/db.ts'
import { keyHash, QuotaTracker } from '../src/cache/quota.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pkp-mcp-test-'))
  dirs.push(dir)
  return dir
}

describe('cache db', () => {
  it('rebuilds the cache when the schema version changes', () => {
    const dir = tempDir()
    const db = openCacheDb(dir)
    setMeta(db, 'x', '1')
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 99}`)
    db.close()

    const reopened = openCacheDb(dir)
    expect(getMeta(reopened, 'x')).toBeUndefined()
    expect((reopened.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
      SCHEMA_VERSION,
    )
    reopened.close()
  })

  it('keeps data across reopen when the schema matches', () => {
    const dir = tempDir()
    const db = openCacheDb(dir)
    setMeta(db, 'x', '1')
    db.close()
    const reopened = openCacheDb(dir)
    expect(getMeta(reopened, 'x')).toBe('1')
    reopened.close()
  })
})

describe('QuotaTracker', () => {
  it('counts requests per key without storing the key', () => {
    const dir = tempDir()
    const db = openCacheDb(dir)
    const quota = new QuotaTracker(db, 'my-secret-key')
    const now = Date.parse('2026-10-11T12:00:00Z')
    quota.record(now - 2 * 60 * 60 * 1000)
    quota.record(
      now - 60 * 1000,
      new Headers({ 'X-RateLimit-Hourly-Remaining': '97', 'X-RateLimit-Daily-Remaining': '990' }),
    )
    expect(quota.snapshot(now)).toMatchObject({
      lastHour: 1,
      lastDay: 2,
      hourlyRemaining: 97,
      dailyRemaining: 990,
    })
    db.close()

    const raw = new DatabaseSync(join(dir, 'cache.db'))
    const dump =
      JSON.stringify(raw.prepare('SELECT * FROM requests').all()) +
      JSON.stringify(raw.prepare('SELECT * FROM quota').all())
    expect(dump).not.toContain('my-secret-key')
    expect(dump).toContain(keyHash('my-secret-key'))
    raw.close()
  })
})
