import { PdpClient } from './api/client.ts'
import { type Db, housekeeping, openCacheDb } from './cache/db.ts'
import { QuotaTracker } from './cache/quota.ts'
import { ScheduleCache } from './cache/scheduleCache.ts'
import type { Config } from './config.ts'
import { Places } from './data/places.ts'
import { Timetables } from './data/timetables.ts'
import { DataVersion } from './data/version.ts'
import { configureLog } from './log.ts'
import type { Context } from './tools/context.ts'

export interface App extends Context {
  config: Config
  db: Db
  quota: QuotaTracker | undefined
}

/** Wires config, cache, API client and data services. Does no network I/O. */
export function createApp(config: Config): App {
  configureLog({ debug: config.debug, secrets: [config.apiKey] })
  const db = openCacheDb(config.cacheDir)
  housekeeping(db, Date.now())
  const quota = config.apiKey === undefined ? undefined : new QuotaTracker(db, config.apiKey)
  const client = new PdpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    onRequest: (at, headers) => quota?.record(at, headers),
  })
  const timetables = new Timetables(client, new ScheduleCache(db, new DataVersion(db, client)))
  return { config, db, quota, client, places: new Places(db, client), timetables, now: Date.now }
}
