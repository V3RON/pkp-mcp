import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Bump on any schema change. Everything here can be re-fetched from the API, so a version
 * mismatch simply drops and recreates the tables instead of migrating them.
 */
export const SCHEMA_VERSION = 1

const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE datasets (name TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL);
  CREATE TABLE stations (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE cities (name TEXT PRIMARY KEY, station_ids TEXT NOT NULL);
  CREATE TABLE http_cache (
    key TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE TABLE requests (key_hash TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE INDEX requests_by_key ON requests (key_hash, at);
  CREATE TABLE quota (
    key_hash TEXT PRIMARY KEY,
    hourly_remaining INTEGER,
    daily_remaining INTEGER,
    observed_at INTEGER NOT NULL
  );
`

export type Db = DatabaseSync

export function openCacheDb(cacheDir: string): Db {
  mkdirSync(cacheDir, { recursive: true })
  const db = new DatabaseSync(join(cacheDir, 'cache.db'))
  // WAL + busy timeout: Claude Code and Codex may run the server at the same time on one cache file.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;')
  migrate(db)
  return db
}

export function openMemoryDb(): Db {
  const db = new DatabaseSync(':memory:')
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  if (row.user_version === SCHEMA_VERSION) return
  transaction(db, () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    for (const { name } of tables) {
      if (!name.startsWith('sqlite_')) db.exec(`DROP TABLE "${name}"`)
    }
    db.exec(SCHEMA)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  })
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getMeta(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setMeta(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

export function datasetFetchedAt(db: Db, name: string): number | undefined {
  const row = db.prepare('SELECT fetched_at FROM datasets WHERE name = ?').get(name) as
    | { fetched_at: number }
    | undefined
  return row?.fetched_at
}

export function markDatasetFetched(db: Db, name: string, at: number): void {
  db.prepare(
    'INSERT INTO datasets (name, fetched_at) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET fetched_at = excluded.fetched_at',
  ).run(name, at)
}

/** Drops expired rows. Cheap; runs once per server start. */
export function housekeeping(db: Db, now: number): void {
  const dayMs = 24 * 60 * 60 * 1000
  db.prepare('DELETE FROM http_cache WHERE expires_at < ?').run(now - dayMs)
  db.prepare('DELETE FROM requests WHERE at < ?').run(now - 2 * dayMs)
}
