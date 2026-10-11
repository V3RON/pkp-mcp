import { PdpClient } from './api/client.ts'
import { type Db, housekeeping, openCacheDb } from './cache/db.ts'
import { QuotaTracker } from './cache/quota.ts'
import type { Config } from './config.ts'
import { Places } from './data/places.ts'
import { LocaleResolver } from './i18n/resolver.ts'
import { configureLog } from './log.ts'
import type { Context } from './tools/context.ts'

export interface App extends Context {
  config: Config
  db: Db
  quota: QuotaTracker | undefined
}

/** Wires config, cache, API client and data services. Does no network I/O. */
export function createApp(config: Config, env: Record<string, string | undefined> = process.env): App {
  configureLog({ debug: config.debug, secrets: [config.apiKey] })
  const db = openCacheDb(config.cacheDir)
  housekeeping(db, Date.now())
  const quota = config.apiKey === undefined ? undefined : new QuotaTracker(db, config.apiKey)
  const client = new PdpClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    onRequest: (at, headers) => quota?.record(at, headers),
  })
  const locale = new LocaleResolver(env, config.langOverride)
  return { config, db, quota, client, places: new Places(db, client), locale }
}
