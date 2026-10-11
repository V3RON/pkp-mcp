import type { PdpClient } from '../api/client.ts'
import { citiesResponse, stationsResponse } from '../api/schemas.ts'
import { type Db, datasetFetchedAt, markDatasetFetched, transaction } from '../cache/db.ts'
import { UserError } from '../errors.ts'
import { log } from '../log.ts'
import { messages as m } from '../messages.ts'
import { normalizeName } from '../text.ts'

export const PLACES_TTL_MS = 30 * 24 * 60 * 60 * 1000
const STATIONS_PAGE_SIZE = 10000

export interface Station {
  kind: 'station'
  id: number
  name: string
}

export interface City {
  kind: 'city'
  name: string
  stationIds: number[]
}

export type Place = Station | City

/** A place a tool should search from/to: one station, or every station of a city. */
export interface ResolvedPlace {
  name: string
  stationIds: number[]
  isCity: boolean
}

export interface PlaceSearch {
  matches: Place[]
  total: number
  /** Set when the catalogue could not be refreshed and older cached data was used. */
  staleSince: number | undefined
}

export interface IndexEntry {
  place: Place
  norm: string
  tokens: string[]
}

/**
 * Station + city catalogue. Fetched once (2 requests), kept in SQLite for 30 days, and served
 * stale when a refresh fails. Lookups run on an in-memory index built from SQLite.
 */
export class Places {
  private readonly db: Db
  private readonly client: PdpClient
  private readonly now: () => number
  private index: IndexEntry[] | undefined
  private stationsById = new Map<number, Station>()
  private refreshing: Promise<void> | undefined

  constructor(db: Db, client: PdpClient, now: () => number = Date.now) {
    this.db = db
    this.client = client
    this.now = now
  }

  /** Makes sure the catalogue is present and fresh. Returns the fetch time of stale data in use, if any. */
  async ensureLoaded(): Promise<number | undefined> {
    const fetchedAt = this.fetchedAt()
    if (fetchedAt !== undefined && this.now() - fetchedAt < PLACES_TTL_MS) {
      this.index ??= this.buildIndex()
      return undefined
    }
    try {
      this.refreshing ??= this.refresh().finally(() => {
        this.refreshing = undefined
      })
      await this.refreshing
      return undefined
    } catch (error) {
      if (fetchedAt === undefined) throw error
      log.warn('station catalogue refresh failed; using cached copy', error)
      this.index ??= this.buildIndex()
      return fetchedAt
    }
  }

  async search(query: string, limit: number): Promise<PlaceSearch> {
    const staleSince = await this.ensureLoaded()
    const ranked = rank(this.index ?? [], query, this.stationsById)
    return { matches: ranked.slice(0, limit), total: ranked.length, staleSince }
  }

  /**
   * Picks the place a free-text query means, or throws a UserError listing candidates. Accepted when
   * the best match is exact, unique, a city whose stations make up all other matches, or in a
   * better ranking tier than the runner-up.
   */
  async resolve(query: string): Promise<ResolvedPlace & { staleSince: number | undefined }> {
    const staleSince = await this.ensureLoaded()
    const ranked = rankScored(this.index ?? [], query, this.stationsById)
    const [top, second] = ranked
    if (!top) throw new UserError(m.noPlaceMatch(query))
    const city = top.place.kind === 'city' ? new Set(top.place.stationIds) : undefined
    const clear =
      !second ||
      top.score >= EXACT ||
      tier(top.score) > tier(second.score) ||
      (city !== undefined && ranked.slice(1).every((r) => r.place.kind === 'station' && city.has(r.place.id)))
    if (!clear)
      throw new UserError(
        m.ambiguousPlace(
          query,
          ranked.slice(0, 4).map((r) => describe(r.place)),
        ),
      )
    const place = top.place
    return place.kind === 'city'
      ? { name: place.name, stationIds: place.stationIds, isCity: true, staleSince }
      : { name: place.name, stationIds: [place.id], isCity: false, staleSince }
  }

  stationName(id: number): string | undefined {
    return this.stationsById.get(id)?.name
  }

  /** Oldest fetch time of the two datasets, or undefined if either is missing. */
  fetchedAt(): number | undefined {
    const stations = datasetFetchedAt(this.db, 'stations')
    const cities = datasetFetchedAt(this.db, 'cities')
    return stations === undefined || cities === undefined ? undefined : Math.min(stations, cities)
  }

  counts(): { stations: number; cities: number } {
    const count = (table: string) =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return { stations: count('stations'), cities: count('cities') }
  }

  private async refresh(): Promise<void> {
    const stations: { id: number; name: string }[] = []
    for (let page = 1; ; page++) {
      const body = stationsResponse.parse(
        await this.client.getJson('api/v1/dictionaries/stations', { page, pageSize: STATIONS_PAGE_SIZE }),
      )
      for (const s of body.stations) if (s.name) stations.push({ id: s.id, name: s.name.trim() })
      if (!body.totalPages || page >= body.totalPages) break
    }
    const cities = citiesResponse
      .parse(await this.client.getJson('api/v1/dictionaries/cities'))
      .cities.flatMap((c) =>
        c.name && c.stationIds?.length ? [{ name: c.name, stationIds: c.stationIds }] : [],
      )
    if (stations.length === 0) throw new Error('Station dictionary came back empty')

    const at = this.now()
    transaction(this.db, () => {
      this.db.exec('DELETE FROM stations; DELETE FROM cities;')
      const insertStation = this.db.prepare('INSERT OR REPLACE INTO stations (id, name) VALUES (?, ?)')
      for (const s of stations) insertStation.run(s.id, s.name)
      const insertCity = this.db.prepare('INSERT OR REPLACE INTO cities (name, station_ids) VALUES (?, ?)')
      for (const c of cities) insertCity.run(c.name, JSON.stringify(c.stationIds))
      markDatasetFetched(this.db, 'stations', at)
      markDatasetFetched(this.db, 'cities', at)
    })
    log.info('station catalogue refreshed', { stations: stations.length, cities: cities.length })
    this.index = this.buildIndex()
  }

  private buildIndex(): IndexEntry[] {
    const stations = this.db.prepare('SELECT id, name FROM stations').all() as { id: number; name: string }[]
    const cities = this.db.prepare('SELECT name, station_ids FROM cities').all() as {
      name: string
      station_ids: string
    }[]
    this.stationsById = new Map(stations.map((s) => [s.id, { kind: 'station', id: s.id, name: s.name }]))
    const entries: IndexEntry[] = []
    for (const station of this.stationsById.values()) entries.push(entry(station))
    for (const c of cities) {
      const ids = (JSON.parse(c.station_ids) as number[]).filter((id) => this.stationsById.has(id))
      // A one-station "city" adds nothing over the station itself.
      if (ids.length > 1)
        entries.push(entry({ kind: 'city', name: cityDisplayName(c.name), stationIds: ids }))
    }
    return entries
  }
}

function entry(place: Place): IndexEntry {
  const norm = normalizeName(place.name)
  return { place, norm, tokens: norm.split(' ') }
}

/** The API returns city names in upper case ("BIELSKO-BIAŁA"); show them as "Bielsko-Biała". */
export function cityDisplayName(name: string): string {
  return name
    .toLocaleLowerCase('pl')
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase('pl'))
}

/**
 * Ranking: numeric ID > exact name > name prefix > every query word is a prefix of a name word
 * (in order) > substring. Within a tier, cities with more stations come first, then shorter names.
 */
export function rank(entries: IndexEntry[], query: string, byId: Map<number, Station>): Place[] {
  return rankScored(entries, query, byId).map((s) => s.place)
}

const EXACT = 100

function rankScored(
  entries: IndexEntry[],
  query: string,
  byId: Map<number, Station>,
): { place: Place; score: number }[] {
  const trimmed = query.trim()
  if (/^\d+$/.test(trimmed)) {
    const station = byId.get(Number(trimmed))
    return station ? [{ place: station, score: EXACT }] : []
  }
  const q = normalizeName(trimmed)
  if (!q) return []
  const qTokens = q.split(' ')
  const scored: { place: Place; score: number }[] = []
  for (const e of entries) {
    const score = scoreEntry(e, q, qTokens)
    if (score > 0) scored.push({ place: e.place, score: score + (e.place.kind === 'city' ? 1 : 0) })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      size(b.place) - size(a.place) ||
      a.place.name.length - b.place.name.length ||
      a.place.name.localeCompare(b.place.name, 'pl'),
  )
  return scored
}

/** Ranking tier without the small city bonus. */
function tier(score: number): number {
  return Math.floor(score / 10)
}

function describe(place: Place): string {
  return place.kind === 'city' ? `${place.name} (${m.city})` : place.name
}

function scoreEntry(e: IndexEntry, q: string, qTokens: string[]): number {
  if (e.norm === q) return EXACT
  if (e.norm.startsWith(q)) return 80
  if (tokensPrefixInOrder(e.tokens, qTokens)) return 60
  if (e.norm.includes(q)) return 40
  return 0
}

function tokensPrefixInOrder(nameTokens: string[], queryTokens: string[]): boolean {
  let i = 0
  for (const qt of queryTokens) {
    while (i < nameTokens.length && !nameTokens[i]?.startsWith(qt)) i++
    if (i === nameTokens.length) return false
    i++
  }
  return true
}

function size(place: Place): number {
  return place.kind === 'city' ? place.stationIds.length : 0
}
