import type { PdpClient } from '../api/client.ts'
import { expandShortSchedules, route, schedulesResponse, shortSchedulesResponse } from '../api/schemas.ts'
import type { ScheduleCache } from '../cache/scheduleCache.ts'
import { log } from '../log.ts'
import { buildNetwork, type Network } from '../planner/network.ts'
import { addDays, dateEpochMs } from '../time.ts'
import { type Timetable, type Trip, toTimetable } from './trips.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const BOARD_TIMEOUT_MS = 30_000
/** The whole-network download is tens of MB. */
const NETWORK_TIMEOUT_MS = 90_000

export interface TimetableResult extends Timetable {
  staleSince: number | undefined
}

export interface NetworkResult {
  network: Network
  staleSince: number | undefined
}

/**
 * Planned timetable queries. All of them include the day before, so trains that started the
 * previous evening and run past midnight are covered.
 */
export class Timetables {
  private readonly client: PdpClient
  private readonly cache: ScheduleCache

  constructor(client: PdpClient, cache: ScheduleCache) {
    this.client = client
    this.cache = cache
  }

  /** Direct trains between two station sets. The API trims each route to the from→to segment. */
  async between(fromIds: number[], toIds: number[], date: string): Promise<TimetableResult> {
    const from = sortedIds(fromIds)
    const to = sortedIds(toIds)
    const dates = [addDays(date, -1), date]
    const { value, staleSince } = await this.cache.get(
      `pair:${from}|${to}|${date}`,
      expiry(date),
      () =>
        this.client.getJson('api/v1/schedules', {
          dateFrom: dates[0],
          dateTo: date,
          fromStations: from,
          toStations: to,
        }),
      (body) => toTimetable(schedulesResponse.parse(body), dates),
    )
    return { ...value, staleSince }
  }

  /**
   * Every train calling at the given stations, with full routes (for origin/destination). If the
   * API returns routes without stops (a known fullRoute fault), falls back to the trimmed variant.
   */
  async at(stationIds: number[], date: string): Promise<TimetableResult> {
    const stations = sortedIds(stationIds)
    const dates = [addDays(date, -1), date]
    const query = { dateFrom: dates[0], dateTo: date, stations }
    const { value, staleSince } = await this.cache.get(
      `board:${stations}|${date}`,
      expiry(date),
      async () => {
        const full = await this.client.getJson(
          'api/v1/schedules',
          { ...query, fullRoute: true },
          { timeoutMs: BOARD_TIMEOUT_MS },
        )
        if (hasStops(schedulesResponse.parse(full).routes)) return full
        log.warn('fullRoute response had no stops; retrying without fullRoute', { stations })
        return this.client.getJson('api/v1/schedules', query)
      },
      (body) => toTimetable(schedulesResponse.parse(body), dates),
    )
    return { ...value, staleSince }
  }

  /**
   * One train's planned route on its operating date. Served from the whole-network timetable when
   * that is cached; otherwise one request, cached like other timetable data.
   */
  async trip(
    scheduleId: number,
    orderId: number,
    operatingDate: string,
  ): Promise<{ trip: Trip | undefined; staleSince: number | undefined }> {
    if (await this.networkReady(operatingDate)) {
      const { network, staleSince } = await this.network(operatingDate)
      const trip = network.trips.find(
        (t) => t.scheduleId === scheduleId && t.orderId === orderId && t.operatingDate === operatingDate,
      )
      if (trip) return { trip, staleSince }
    }
    const { value, staleSince } = await this.cache.get(
      `route:${scheduleId}/${orderId}`,
      Date.now() + 7 * DAY_MS,
      () => this.client.getJson(`api/v1/schedules/route/${scheduleId}/${orderId}`),
      (body) => route.parse(body),
    )
    const [trip] = toTimetable({ routes: [value] }, [operatingDate]).trips
    return { trip, staleSince }
  }

  /** Trains with this number on a date. Needs the whole-network timetable (one large request per date). */
  async byNumber(number: string, date: string): Promise<{ trips: Trip[]; staleSince: number | undefined }> {
    const wanted = normalizeNumber(number)
    const { network, staleSince } = await this.network(date)
    const trips = network.trips.filter(
      (t) =>
        t.operatingDate === date &&
        (normalizeNumber(t.number ?? '') === wanted ||
          t.stops.some((s) => normalizeNumber(s.number ?? '') === wanted)),
    )
    return { trips, staleSince }
  }

  /** Whether the whole-network timetable for `date` is cached, i.e. transfer search costs no request. */
  networkReady(date: string): Promise<boolean> {
    return this.cache.isReady(networkKey(date))
  }

  /** The whole network for `date` (one large request per date), indexed for transfer search. */
  async network(date: string): Promise<NetworkResult> {
    const dates = [addDays(date, -1), date]
    const query = { dateFrom: dates[0], dateTo: date, dictionaries: false }
    const { value, staleSince } = await this.cache.get(
      networkKey(date),
      expiry(date),
      async () => {
        const started = Date.now()
        const full = await this.client.getJson(
          'api/v1/schedules/shortened',
          { ...query, fullRoute: true },
          { timeoutMs: NETWORK_TIMEOUT_MS },
        )
        const routes = shortSchedulesResponse.parse(full).rt ?? []
        log.info('network timetable downloaded', { date, routes: routes.length, ms: Date.now() - started })
        if (routes.length === 0 || routes.some((r) => (r.st?.length ?? 0) > 0)) return full
        log.warn('fullRoute network response had no stops; retrying without fullRoute', { date })
        return this.client.getJson('api/v1/schedules/shortened', query, { timeoutMs: NETWORK_TIMEOUT_MS })
      },
      (body) => buildNetwork(toTimetable(expandShortSchedules(body), dates).trips, date),
    )
    return { network: value, staleSince }
  }
}

function hasStops(routes: { stations?: unknown[] | null | undefined }[] | null | undefined): boolean {
  return !routes?.length || routes.some((r) => (r.stations?.length ?? 0) > 0)
}

/** "IC 3510", "3510", "35 10" → "3510" (numbers are compared without category or spaces). */
function normalizeNumber(value: string): string {
  return value.replace(/^[A-Za-z]+\s*/, '').replace(/\s+/g, '')
}

function networkKey(date: string): string {
  return `network:${date}`
}

function sortedIds(ids: number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',')
}

/** Keep a day's timetable until two days after it (overnight trains, late follow-up questions). */
function expiry(date: string): number {
  return dateEpochMs(date) + 2 * DAY_MS
}
