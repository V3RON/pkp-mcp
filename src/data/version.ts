import type { PdpClient } from '../api/client.ts'
import { dataVersionResponse } from '../api/schemas.ts'
import { type Db, getMeta, setMeta } from '../cache/db.ts'
import { log } from '../log.ts'

const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * The API's `schedulesVersion` GUID changes whenever the published timetable changes. Checked at
 * most once an hour (shared across processes through SQLite) and only when cached data needs it.
 */
export class DataVersion {
  private readonly db: Db
  private readonly client: PdpClient
  private readonly now: () => number
  private pending: Promise<string | undefined> | undefined

  constructor(db: Db, client: PdpClient, now: () => number = Date.now) {
    this.db = db
    this.client = client
    this.now = now
  }

  /** Last known version without any network call. */
  known(): string | undefined {
    return getMeta(this.db, 'schedulesVersion')
  }

  /** Current schedules version, or undefined if it cannot be determined right now. */
  async schedules(): Promise<string | undefined> {
    const checkedAt = Number(getMeta(this.db, 'schedulesVersionCheckedAt') ?? 0)
    if (this.now() - checkedAt < CHECK_INTERVAL_MS) return this.known()
    this.pending ??= this.fetch().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async fetch(): Promise<string | undefined> {
    try {
      const body = dataVersionResponse.parse(await this.client.getJson('api/v1/data-version'))
      const version = body.schedulesVersion ?? body.dataVersion ?? undefined
      if (version) setMeta(this.db, 'schedulesVersion', version)
      setMeta(this.db, 'schedulesVersionCheckedAt', String(this.now()))
      return version ?? this.known()
    } catch (error) {
      log.warn('data-version check failed', error)
      return undefined
    }
  }
}
