import { describe, expect, it } from 'vitest'
import { PdpClient } from '../src/api/client.ts'
import { openMemoryDb } from '../src/cache/db.ts'
import { cityDisplayName, PLACES_TTL_MS, Places } from '../src/data/places.ts'
import { catalogueRoutes, fakeFetch, json, noSleep } from './helpers.ts'

function setup(routes = catalogueRoutes) {
  let now = Date.parse('2026-10-11T12:00:00Z')
  const fake = fakeFetch(routes)
  const db = openMemoryDb()
  const client = new PdpClient({
    baseUrl: 'https://api.test',
    apiKey: 'k',
    fetch: fake.fetch,
    sleep: noSleep,
  })
  const places = new Places(db, client, () => now)
  return { places, db, client, calls: fake.calls, advance: (ms: number) => (now += ms) }
}

const names = (r: { matches: { name: string }[] }) => r.matches.map((m) => m.name)

describe('Places', () => {
  it('fetches the catalogue once and answers later lookups from the cache', async () => {
    const { places, calls } = setup()
    await places.search('krakow', 5)
    await places.search('lodz', 5)
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/api/v1/dictionaries/stations',
      '/api/v1/dictionaries/cities',
    ])
    expect(calls[0]?.url.searchParams.get('pageSize')).toBe('10000')
  })

  it('ranks the city first for a bare city name, then its stations', async () => {
    const { places } = setup()
    const result = await places.search('Warszawa', 3)
    expect(result.matches[0]).toMatchObject({
      kind: 'city',
      name: 'Warszawa',
      stationIds: [33605, 33506, 34868, 34587],
    })
    expect(result.total).toBe(5)
  })

  it('matches without diacritics and by word prefixes', async () => {
    const { places } = setup()
    expect(names(await places.search('krakow plaszow', 5))).toEqual(['Kraków Płaszów'])
    expect(names(await places.search('wwa zach', 5))).toEqual([])
    expect(names(await places.search('warsz zach', 5))).toEqual(['Warszawa Zachodnia'])
    expect(names(await places.search('Lodz', 5))[0]).toBe('Łódź')
  })

  it('looks up a numeric query as a station ID', async () => {
    const { places } = setup()
    expect((await places.search('33019', 5)).matches).toEqual([
      { kind: 'station', id: 33019, name: 'Kraków Główny' },
    ])
  })

  it('skips one-station cities, since the station already covers them', async () => {
    const { places } = setup()
    expect((await places.search('Żywiec', 5)).matches).toEqual([
      { kind: 'station', id: 70002, name: 'Żywiec' },
    ])
  })

  it('refreshes after the TTL and serves stale data if the refresh fails', async () => {
    let up = true
    const routes = Object.fromEntries(
      Object.entries(catalogueRoutes).map(([path, handler]) => [
        path,
        (u: URL) => (up ? handler(u) : json({}, 500)),
      ]),
    )
    const { places, calls, advance } = setup(routes)
    await places.search('krakow', 5)
    const firstFetch = places.fetchedAt()
    advance(PLACES_TTL_MS + 1)
    up = false
    const result = await places.search('krakow', 5)
    expect(result.staleSince).toBe(firstFetch)
    expect(names(result)[0]).toBe('Kraków')
    expect(calls.length).toBeGreaterThan(2)
  })
})

describe('cityDisplayName', () => {
  it('title-cases upper-case city names, including after hyphens', () => {
    expect(cityDisplayName('BIELSKO-BIAŁA')).toBe('Bielsko-Biała')
    expect(cityDisplayName('ŁÓDŹ')).toBe('Łódź')
    expect(cityDisplayName('NOWY SĄCZ')).toBe('Nowy Sącz')
  })
})
