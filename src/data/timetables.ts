import type { PdpClient } from '../api/client.ts'
import { schedulesResponse } from '../api/schemas.ts'
import type { ScheduleCache } from '../cache/scheduleCache.ts'
import { log } from '../log.ts'
import { addDays, dateEpochMs } from '../time.ts'
import { type Timetable, toTimetable } from './trips.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const SNAPSHOT_TIMEOUT_MS = 30_000

export interface TimetableResult extends Timetable {
  staleSince: number | undefined
}

/**
 * Planned timetable queries. Both ask for the day before as well, so trains that started the
 * previous evening and pass the station after midnight are included.
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
    const { body, staleSince } = await this.cache.get(`pair:${from}|${to}|${date}`, expiry(date), () =>
      this.client.getJson('api/v1/schedules', {
        dateFrom: dates[0],
        dateTo: date,
        fromStations: from,
        toStations: to,
      }),
    )
    return { ...toTimetable(schedulesResponse.parse(body), dates), staleSince }
  }

  /**
   * Every train calling at the given stations, with full routes (for origin/destination). If the
   * API returns routes without stops (a known fullRoute fault), falls back to the trimmed variant.
   */
  async at(stationIds: number[], date: string): Promise<TimetableResult> {
    const stations = sortedIds(stationIds)
    const dates = [addDays(date, -1), date]
    const query = { dateFrom: dates[0], dateTo: date, stations }
    const { body, staleSince } = await this.cache.get(`board:${stations}|${date}`, expiry(date), async () => {
      const full = await this.client.getJson(
        'api/v1/schedules',
        { ...query, fullRoute: true },
        { timeoutMs: SNAPSHOT_TIMEOUT_MS },
      )
      const routes = schedulesResponse.parse(full).routes ?? []
      if (routes.length === 0 || routes.some((r) => (r.stations?.length ?? 0) > 0)) return full
      log.warn('fullRoute response had no stops; retrying without fullRoute', { stations })
      return this.client.getJson('api/v1/schedules', query)
    })
    return { ...toTimetable(schedulesResponse.parse(body), dates), staleSince }
  }
}

function sortedIds(ids: number[]): string {
  return [...new Set(ids)].sort((a, b) => a - b).join(',')
}

/** Keep a day's timetable until two days after it (overnight trains, late follow-up questions). */
function expiry(date: string): number {
  return dateEpochMs(date) + 2 * DAY_MS
}
