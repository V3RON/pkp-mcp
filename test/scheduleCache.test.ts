import { describe, expect, it } from 'vitest'
import { PdpClient } from '../src/api/client.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { ScheduleCache } from '../src/cache/scheduleCache.ts'
import { DataVersion } from '../src/data/version.ts'
import { fakeFetch, json, noSleep } from './helpers.ts'

const HOUR = 60 * 60 * 1000

function setup() {
  let now = Date.parse('2026-10-12T08:00:00Z')
  let version = 'v1'
  const fake = fakeFetch({
    '/api/v1/data-version': () => json({ schedulesVersion: version, dataVersion: 'x' }),
  })
  const db = openMemoryDb()
  const client = new PdpClient({
    baseUrl: 'https://api.test',
    apiKey: 'k',
    fetch: fake.fetch,
    sleep: noSleep,
  })
  const cache = new ScheduleCache(db, new DataVersion(db, client, () => now), () => now)
  let fetches = 0
  let failing = false
  const fetcher = async () => {
    if (failing) throw new Error('down')
    fetches++
    return { n: fetches }
  }
  return {
    get: async () => {
      const { value, staleSince } = await cache.get('k', now + 48 * HOUR, fetcher, (body) => body)
      return { body: value, staleSince }
    },
    fetches: () => fetches,
    versionChecks: () => fake.calls.length,
    advance: (ms: number) => (now += ms),
    setVersion: (v: string) => (version = v),
    fail: () => (failing = true),
  }
}

describe('ScheduleCache', () => {
  it('reuses an entry for an hour without any request', async () => {
    const s = setup()
    await s.get()
    const checks = s.versionChecks()
    s.advance(HOUR - 1)
    expect((await s.get()).body).toEqual({ n: 1 })
    expect(s.fetches()).toBe(1)
    expect(s.versionChecks()).toBe(checks)
  })

  it('after an hour, keeps the entry while the timetable version is unchanged', async () => {
    const s = setup()
    await s.get() // tagged with v1, looked up before the download
    s.advance(2 * HOUR)
    expect((await s.get()).body).toEqual({ n: 1 })
    expect(s.fetches()).toBe(1)
    expect(s.versionChecks()).toBe(2)
  })

  it('refetches when the timetable version changes', async () => {
    const s = setup()
    await s.get()
    s.setVersion('v2')
    s.advance(2 * HOUR)
    expect((await s.get()).body).toEqual({ n: 2 })
  })

  it('refetches after a day regardless of version', async () => {
    const s = setup()
    await s.get()
    s.advance(25 * HOUR)
    expect((await s.get()).body).toEqual({ n: 2 })
  })

  it('serves the old copy, marked stale, when a refresh fails', async () => {
    const s = setup()
    await s.get()
    s.advance(25 * HOUR)
    s.fail()
    const result = await s.get()
    expect(result.body).toEqual({ n: 1 })
    expect(result.staleSince).toBe(Date.parse('2026-10-12T08:00:00Z'))
  })
})
